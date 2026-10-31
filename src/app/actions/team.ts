"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { addDaysStr, dateOnly, localDateStr, localToUtc, mondayOf } from "@/lib/time";
import { applyChanges, createScenarioFromReal } from "@/lib/sim/scenario";
import { loadTeamData } from "@/lib/team/readiness";
import { proposeReplacements } from "@/lib/team/replacement";

type Result = { ok?: true; error?: string; id?: string };
const fail = (e: unknown): Result => ({
  error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "câmp"}: ${i.message}`).join("; ") : e instanceof Error ? e.message : "Eroare",
});
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dată invalidă");
const optDate = dateStr.optional().nullable().or(z.literal("")).transform((v) => (v ? v : null));

function refresh(employeeId?: string) {
  revalidatePath("/admin/team");
  if (employeeId) {
    revalidatePath(`/admin/team/${employeeId}`);
    revalidatePath(`/admin/employees/${employeeId}`);
  }
}

// ---------------------------------------------------------------- semafor override

const overrideSchema = z.object({
  employeeId: z.string().min(1),
  color: z.enum(["GREEN", "ORANGE", "RED"]),
  reason: z.string().trim().min(3, "scrie motivul (minim 3 caractere)").max(500),
  validUntil: optDate,
});

export async function setReadinessOverride(input: z.input<typeof overrideSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = overrideSchema.parse(input);
    const o = await prisma.readinessOverride.create({
      data: { employeeId: d.employeeId, color: d.color, reason: d.reason, validUntil: d.validUntil ? dateOnly(d.validUntil) : null, setById: s.userId },
    });
    await audit(s.userId, "ReadinessOverride", o.id, "CREATE", d);
    refresh(d.employeeId);
    return { ok: true, id: o.id };
  } catch (e) {
    return fail(e);
  }
}

/** Ends every active override: the automatic colour applies again (history is kept). */
export async function clearReadinessOverride(employeeId: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const yesterday = dateOnly(addDaysStr(localDateStr(new Date()), -1));
    const today = dateOnly(localDateStr(new Date()));
    const r = await prisma.readinessOverride.updateMany({
      where: { employeeId, OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
      data: { validUntil: yesterday },
    });
    await audit(s.userId, "ReadinessOverride", employeeId, "CLEAR", { count: r.count });
    refresh(employeeId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- availability (leave, resignation, …)

const eventSchema = z
  .object({
    employeeId: z.string().min(1),
    type: z.enum(["LEAVE", "MATERNITY", "SECONDMENT", "TRAINING", "RESIGNATION", "CONTRACT_END", "OTHER"]),
    startDate: dateStr,
    endDate: optDate,
    announcedAt: optDate,
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: "data de sfârșit e înaintea celei de început", path: ["endDate"] })
  .refine((d) => ["RESIGNATION", "CONTRACT_END"].includes(d.type) || !!d.endDate, { message: "alege data de întoarcere", path: ["endDate"] });

export async function addAvailabilityEvent(input: z.input<typeof eventSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = eventSchema.parse(input);
    const permanent = d.type === "RESIGNATION" || d.type === "CONTRACT_END";
    const ev = await prisma.availabilityEvent.create({
      data: {
        employeeId: d.employeeId,
        type: d.type,
        startDate: dateOnly(d.startDate),
        endDate: permanent || !d.endDate ? null : dateOnly(d.endDate),
        announcedAt: d.announcedAt ? dateOnly(d.announcedAt) : dateOnly(localDateStr(new Date())),
        note: d.note || null,
        createdById: s.userId,
      },
    });
    await audit(s.userId, "AvailabilityEvent", ev.id, "CREATE", d);
    refresh(d.employeeId);
    return { ok: true, id: ev.id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAvailabilityEvent(id: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const ev = await prisma.availabilityEvent.delete({ where: { id } });
    await audit(s.userId, "AvailabilityEvent", id, "DELETE", { type: ev.type, startDate: ev.startDate });
    refresh(ev.employeeId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- apply a proposal in a simulation scenario

const whatIfSchema = z.object({ type: z.enum(["RESIGNATION", "LEAVE", "MATERNITY", "SECONDMENT", "CONTRACT_END", "OTHER", "TRAINING"]), start: dateStr, end: optDate }).nullish();

export async function applySolutionToScenario(input: {
  employeeId: string;
  horizon: number;
  extensionDays: number;
  optionIndex: number;
  whatIf?: { type: string; start: string; end?: string | null } | null;
}): Promise<Result> {
  try {
    const s = await assertAdmin();
    const data = await loadTeamData();
    // recompute on the server: never trust changes coming from the browser
    const whatIf = whatIfSchema.parse(input.whatIf ?? null);
    const res = proposeReplacements(data, input.employeeId, { horizon: input.horizon, extensionDays: input.extensionDays, whatIf });
    const opt = res?.options[input.optionIndex];
    if (!res || !opt) return { error: "Propunerea nu mai există (datele s-au schimbat). Reîncarcă pagina." };
    if (opt.changes.length === 0) return { error: "Propunerea asta nu schimbă turele (nu are ce simula)." };
    const start = mondayOf(new Date());
    const sc = await createScenarioFromReal({
      name: `Soluție: ${res.employee.name} — ${opt.title}`.slice(0, 120),
      createdById: s.userId,
      periodStart: localToUtc(start, "00:00"),
      periodEnd: localToUtc(addDaysStr(start, 21), "00:00"),
      notes: [`Generat din pagina Echipa pentru ${res.employee.name} (${res.employee.department})${whatIf ? " — ipoteză, nesalvată în fișă" : ""}.`, ...opt.steps].join("\n"),
    });
    await applyChanges(sc.id, opt.changes, opt.title);
    await audit(s.userId, "Scenario", sc.id, "CREATE_FROM_SOLUTION", { employeeId: input.employeeId, option: opt.title });
    revalidatePath("/admin/simulation");
    return { ok: true, id: sc.id };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- candidates (talent pool)

const candidateSchema = z.object({
  firstName: z.string().trim().min(1, "obligatoriu"),
  lastName: z.string().trim().min(1, "obligatoriu"),
  email: z.string().trim().toLowerCase().email("email invalid"),
  phone: z.string().trim().optional().nullable(),
  university: z.string().trim().min(2, "obligatoriu"),
  specialization: z.string().trim().min(2, "obligatoriu"),
  studyYear: z.string().trim().min(1, "obligatoriu"),
  event: z.string().trim().min(2, "obligatoriu"),
  eventDate: optDate,
  interests: z.array(z.string()).default([]),
  availableFrom: optDate,
  consent: z.boolean(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function saveCandidate(id: string | null, input: z.input<typeof candidateSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = candidateSchema.parse(input);
    if (!d.consent) return { error: "Fără acordul candidatului (GDPR) nu putem păstra datele în baza de talente." };
    const values = {
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone || null,
      university: d.university,
      specialization: d.specialization,
      studyYear: d.studyYear,
      event: d.event,
      eventDate: d.eventDate ? dateOnly(d.eventDate) : null,
      interests: d.interests,
      availableFrom: d.availableFrom ? dateOnly(d.availableFrom) : null,
      notes: d.notes || null,
    };
    if (id) {
      const before = await prisma.candidate.findUniqueOrThrow({ where: { id } });
      await prisma.candidate.update({ where: { id }, data: { ...values, consentAt: before.consentAt ?? new Date() } });
      await audit(s.userId, "Candidate", id, "UPDATE", values);
    } else {
      const c = await prisma.candidate.create({ data: { ...values, consentAt: new Date() } });
      id = c.id;
      await audit(s.userId, "Candidate", id, "CREATE", values);
    }
    revalidatePath("/admin/candidates");
    revalidatePath("/admin/team");
    return { ok: true, id };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") return { error: "Există deja un candidat cu acest email." };
    return fail(e);
  }
}

export async function setCandidateStatus(id: string, status: "NEW" | "CONTACTED" | "INTERVIEW" | "OFFER" | "REJECTED"): Promise<Result> {
  try {
    const s = await assertAdmin();
    z.enum(["NEW", "CONTACTED", "INTERVIEW", "OFFER", "REJECTED"]).parse(status);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id } });
    if (c.status === "HIRED") return { error: "Candidatul a fost deja angajat." };
    await prisma.candidate.update({ where: { id }, data: { status } });
    await audit(s.userId, "Candidate", id, "UPDATE_STATUS", { status: { from: c.status, to: status } });
    revalidatePath("/admin/candidates");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Removes the person from the pool (e.g. consent withdrawn). Hired candidates keep only the employee record. */
export async function deleteCandidate(id: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    await prisma.candidateSkill.deleteMany({ where: { candidateId: id } });
    await prisma.candidate.delete({ where: { id } });
    await audit(s.userId, "Candidate", id, "DELETE");
    revalidatePath("/admin/candidates");
    revalidatePath("/admin/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const candSkillSchema = z.object({
  candidateId: z.string(),
  skillId: z.string(),
  proficiency: z.coerce.number().int().min(1).max(3),
  expiresAt: optDate,
});

export async function upsertCandidateSkill(input: z.input<typeof candSkillSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = candSkillSchema.parse(input);
    const data = { proficiency: d.proficiency, expiresAt: d.expiresAt ? dateOnly(d.expiresAt) : null };
    await prisma.candidateSkill.upsert({
      where: { candidateId_skillId: { candidateId: d.candidateId, skillId: d.skillId } },
      create: { candidateId: d.candidateId, skillId: d.skillId, ...data },
      update: data,
    });
    await audit(s.userId, "CandidateSkill", d.candidateId, "UPSERT", d);
    revalidatePath(`/admin/candidates/${d.candidateId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeCandidateSkill(candidateId: string, skillId: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    await prisma.candidateSkill.delete({ where: { candidateId_skillId: { candidateId, skillId } } });
    await audit(s.userId, "CandidateSkill", candidateId, "DELETE", { skillId });
    revalidatePath(`/admin/candidates/${candidateId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const hireSchema = z.object({
  candidateId: z.string(),
  departmentId: z.string().min(1, "alege departamentul"),
  teamId: z.string().optional().nullable(),
  levelId: z.string().min(1),
  hireDate: dateStr,
  contractEndDate: optDate,
  createAccount: z.boolean().default(true),
});

/** Converts a candidate into an employee: copies the skills, marks the candidate as hired. */
export async function hireCandidate(input: z.input<typeof hireSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = hireSchema.parse(input);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: d.candidateId }, include: { skills: true } });
    if (c.hiredEmployeeId) return { error: "Candidatul a fost deja angajat." };
    if (d.teamId) {
      const team = await prisma.team.findUnique({ where: { id: d.teamId } });
      if (!team || team.departmentId !== d.departmentId) return { error: "Echipa nu aparține departamentului ales." };
    }
    if (await prisma.employee.findUnique({ where: { email: c.email } })) return { error: "Există deja un angajat cu emailul candidatului." };
    const hire = dateOnly(d.hireDate);
    const emp = await prisma.employee.create({
      data: {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        departmentId: d.departmentId,
        teamId: d.teamId || null,
        levelId: d.levelId,
        hireDate: hire,
        levelSince: hire,
        contractEndDate: d.contractEndDate ? dateOnly(d.contractEndDate) : null,
        skills: { create: c.skills.map((k) => ({ skillId: k.skillId, proficiency: k.proficiency, obtainedAt: hire, expiresAt: k.expiresAt })) },
      },
    });
    await prisma.candidate.update({ where: { id: c.id }, data: { status: "HIRED", hiredEmployeeId: emp.id } });
    if (d.createAccount && process.env.SEED_DEMO_PASSWORD && !(await prisma.user.findUnique({ where: { email: c.email } }))) {
      await prisma.user.create({ data: { email: c.email, passwordHash: await bcrypt.hash(process.env.SEED_DEMO_PASSWORD, 10), role: "EMPLOYEE", employeeId: emp.id } });
    }
    await audit(s.userId, "Candidate", c.id, "HIRE", { employeeId: emp.id, departmentId: d.departmentId, teamId: d.teamId });
    revalidatePath("/admin/candidates");
    revalidatePath("/admin/employees");
    revalidatePath("/admin/team");
    return { ok: true, id: emp.id };
  } catch (e) {
    return fail(e);
  }
}
