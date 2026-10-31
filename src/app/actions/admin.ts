"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import { audit, changedFields } from "@/lib/audit";
import { addDaysStr, dateOnly, localDateStr, localToUtc, shiftInterval } from "@/lib/time";

type Result = { ok?: true; error?: string; id?: string };

const fail = (e: unknown): Result => ({ error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : "Eroare" });

// ---------------------------------------------------------------- employees

const employeeSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().optional().nullable(),
  departmentId: z.string().min(1),
  teamId: z.string().optional().nullable(),
  levelId: z.string().min(1),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
});

export async function saveEmployee(id: string | null, input: z.input<typeof employeeSchema> & { createAccount?: boolean }): Promise<Result> {
  try {
    const s = await assertAdmin();
    const data = employeeSchema.parse(input);
    if (data.teamId) {
      const team = await prisma.team.findUnique({ where: { id: data.teamId } });
      if (!team || team.departmentId !== data.departmentId) return { error: "Echipa nu aparține departamentului ales." };
    }
    const values = {
      ...data,
      teamId: data.teamId || null,
      phone: data.phone || null,
      hireDate: dateOnly(data.hireDate),
      contractEndDate: data.contractEndDate ? dateOnly(data.contractEndDate) : null,
    };
    if (id) {
      const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
      const levelChanged = before.levelId !== values.levelId;
      const after = await prisma.employee.update({ where: { id }, data: { ...values, ...(levelChanged ? { levelSince: new Date() } : {}) } });
      await audit(s.userId, "Employee", id, "UPDATE", changedFields(before, after));
    } else {
      const created = await prisma.employee.create({ data: { ...values, levelSince: new Date() } });
      id = created.id;
      await audit(s.userId, "Employee", id, "CREATE", values);
      if (input.createAccount) {
        const pwd = process.env.SEED_DEMO_PASSWORD;
        if (pwd) {
          await prisma.user.create({ data: { email: values.email, passwordHash: await bcrypt.hash(pwd, 10), role: "EMPLOYEE", employeeId: id } });
          await audit(s.userId, "User", id, "CREATE", { email: values.email });
        }
      }
    }
    revalidatePath("/admin/employees");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/** No physical deletion: employees are deactivated. */
export async function setEmployeeActive(id: string, active: boolean): Promise<Result> {
  try {
    const s = await assertAdmin();
    await prisma.employee.update({ where: { id }, data: { active } });
    await audit(s.userId, "Employee", id, active ? "ACTIVATE" : "DEACTIVATE");
    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const skillSchema = z.object({
  employeeId: z.string(),
  skillId: z.string(),
  proficiency: z.coerce.number().int().min(1).max(3),
  obtainedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
});

export async function upsertEmployeeSkill(input: z.input<typeof skillSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = skillSchema.parse(input);
    const values = { proficiency: d.proficiency, obtainedAt: dateOnly(d.obtainedAt), expiresAt: d.expiresAt ? dateOnly(d.expiresAt) : null };
    await prisma.employeeSkill.upsert({
      where: { employeeId_skillId: { employeeId: d.employeeId, skillId: d.skillId } },
      update: values,
      create: { employeeId: d.employeeId, skillId: d.skillId, ...values },
    });
    await audit(s.userId, "EmployeeSkill", `${d.employeeId}:${d.skillId}`, "UPSERT", values);
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeEmployeeSkill(employeeId: string, skillId: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    await prisma.employeeSkill.delete({ where: { employeeId_skillId: { employeeId, skillId } } });
    await audit(s.userId, "EmployeeSkill", `${employeeId}:${skillId}`, "DELETE");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- departments & teams

export async function saveDepartment(id: string | null, name: string, code: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = z.object({ name: z.string().trim().min(2), code: z.string().trim().toUpperCase().min(2).max(6) }).parse({ name, code });
    if (id) {
      const before = await prisma.department.findUniqueOrThrow({ where: { id } });
      const after = await prisma.department.update({ where: { id }, data: d });
      await audit(s.userId, "Department", id, "UPDATE", changedFields(before, after));
    } else {
      const c = await prisma.department.create({ data: d });
      await audit(s.userId, "Department", c.id, "CREATE", d);
    }
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTeam(id: string | null, departmentId: string, name: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const n = z.string().trim().min(1).parse(name);
    if (id) {
      const before = await prisma.team.findUniqueOrThrow({ where: { id } });
      await prisma.team.update({ where: { id }, data: { name: n } });
      await audit(s.userId, "Team", id, "UPDATE", { name: { from: before.name, to: n } });
    } else {
      const t = await prisma.team.create({ data: { departmentId, name: n } });
      await audit(s.userId, "Team", t.id, "CREATE", { departmentId, name: n });
    }
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- shifts

const shiftSchema = z.object({
  departmentId: z.string().min(1),
  teamId: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  templateId: z.string().optional().nullable(),
});

export async function saveShift(id: string | null, input: z.input<typeof shiftSchema>): Promise<Result> {
  try {
    const s = await assertAdmin();
    const d = shiftSchema.parse(input);
    const { startAt, endAt } = shiftInterval(d.date, d.start, d.end);
    const values = { departmentId: d.departmentId, teamId: d.teamId || null, date: dateOnly(d.date), startAt, endAt, templateId: d.templateId || null };
    if (id) {
      const before = await prisma.shift.findUniqueOrThrow({ where: { id } });
      const after = await prisma.shift.update({ where: { id }, data: values });
      await audit(s.userId, "Shift", id, "UPDATE", changedFields(before, after));
    } else {
      const c = await prisma.shift.create({ data: values });
      id = c.id;
      // pre-fill with the active members of the team
      if (values.teamId) {
        const members = await prisma.employee.findMany({ where: { teamId: values.teamId, active: true }, include: { level: true } });
        const lead = [...members].sort((a, b) => b.level.rank - a.level.rank)[0];
        if (members.length) {
          await prisma.shiftAssignment.createMany({ data: members.map((m) => ({ shiftId: c.id, employeeId: m.id, isLead: m.id === lead?.id && lead.level.rank >= 3 })) });
        }
      }
      await audit(s.userId, "Shift", id, "CREATE", { ...values, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    }
    revalidatePath("/admin/shifts");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteShift(id: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const before = await prisma.shift.findUniqueOrThrow({ where: { id }, include: { assignments: true } });
    await prisma.shift.delete({ where: { id } });
    await audit(s.userId, "Shift", id, "DELETE", { startAt: before.startAt, departmentId: before.departmentId, assignments: before.assignments.length });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function assignEmployee(shiftId: string, employeeId: string, positionId?: string | null, isLead = false): Promise<Result> {
  try {
    const s = await assertAdmin();
    const a = await prisma.shiftAssignment.create({ data: { shiftId, employeeId, positionId: positionId || null, isLead } });
    await audit(s.userId, "ShiftAssignment", a.id, "CREATE", { shiftId, employeeId, positionId, isLead });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAssignment(id: string, data: { positionId?: string | null; isLead?: boolean }): Promise<Result> {
  try {
    const s = await assertAdmin();
    const before = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id } });
    const after = await prisma.shiftAssignment.update({ where: { id }, data });
    await audit(s.userId, "ShiftAssignment", id, "UPDATE", changedFields(before, after));
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function unassign(id: string): Promise<Result> {
  try {
    const s = await assertAdmin();
    const before = await prisma.shiftAssignment.delete({ where: { id } });
    await audit(s.userId, "ShiftAssignment", id, "DELETE", before);
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Copy all shifts (and assignments) of a week (Monday "yyyy-MM-dd") to the following week. */
export async function copyWeek(monday: string, departmentId?: string | null): Promise<Result & { count?: number }> {
  try {
    const s = await assertAdmin();
    const from = localToUtc(monday, "00:00");
    const to = localToUtc(addDaysStr(monday, 7), "00:00");
    const targetFrom = to;
    const targetTo = localToUtc(addDaysStr(monday, 14), "00:00");
    const where = { startAt: { gte: targetFrom, lt: targetTo }, ...(departmentId ? { departmentId } : {}) };
    const existing = await prisma.shift.count({ where });
    if (existing > 0) return { error: `Săptămâna următoare are deja ${existing} ture. Șterge-le întâi sau alege alt departament.` };
    const shifts = await prisma.shift.findMany({ where: { startAt: { gte: from, lt: to }, ...(departmentId ? { departmentId } : {}) }, include: { assignments: true } });
    for (const sh of shifts) {
      const newDate = addDaysStr(localDateStr(sh.startAt), 7);
      const { startAt, endAt } = shiftInterval(newDate, toHHmm(sh.startAt), toHHmm(sh.endAt));
      await prisma.shift.create({
        data: {
          departmentId: sh.departmentId,
          teamId: sh.teamId,
          templateId: sh.templateId,
          date: dateOnly(newDate),
          startAt,
          endAt,
          assignments: { create: sh.assignments.map((a) => ({ employeeId: a.employeeId, positionId: a.positionId, isLead: a.isLead })) },
        },
      });
    }
    await audit(s.userId, "Shift", monday, "COPY_WEEK", { departmentId: departmentId ?? "ALL", count: shifts.length });
    revalidatePath("/admin/shifts");
    return { ok: true, count: shifts.length };
  } catch (e) {
    return fail(e);
  }
}

function toHHmm(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
