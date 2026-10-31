// Team readiness ("semafor") and department balance.
// GREEN  = will be at work for the whole horizon, nothing that blocks them.
// ORANGE = something planned inside the horizon (leave, training, a certificate to renew, a contract ending soon after).
// RED    = you cannot count on them for the next project: they leave inside the horizon, are away for most of it,
//          or a mandatory certificate has expired / is about to.
// An admin override (with a reason) wins over the automatic colour while it is valid.
// Deliberately no medical data and no "risk" guessing: only facts the admin entered.
import { prisma } from "@/lib/db";
import { addDaysStr, localDateStr } from "@/lib/time";

export type Color = "GREEN" | "ORANGE" | "RED";
export const HORIZONS = [30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];
export const COLOR_RANK: Record<Color, number> = { GREEN: 0, ORANGE: 1, RED: 2 };

export const AVAILABILITY_LABELS: Record<string, string> = {
  LEAVE: "Concediu de odihnă",
  MATERNITY: "Concediu maternitate / creștere copil",
  SECONDMENT: "Detașare",
  TRAINING: "Curs / training",
  RESIGNATION: "Demisie",
  CONTRACT_END: "Final de contract",
  OTHER: "Altă indisponibilitate",
};
/** Event types meaning "leaves for good" (no end date). */
export const PERMANENT_TYPES = new Set(["RESIGNATION", "CONTRACT_END"]);

// ---------------------------------------------------------------------------- data
export type TeamData = Awaited<ReturnType<typeof loadTeamData>>;
export type TeamEmployee = TeamData["employees"][number];

const ds = (d: Date) => d.toISOString().slice(0, 10);

export async function loadTeamData() {
  const [departments, skills, levels, rawEmployees, overrides, events, leaveRequests, candidates] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: {
        teams: { orderBy: { name: "asc" } },
        positions: { include: { skills: true }, orderBy: { name: "asc" } },
        staffing: true,
      },
    }),
    prisma.skill.findMany({ orderBy: { name: "asc" } }),
    prisma.level.findMany({ orderBy: { rank: "asc" } }),
    prisma.employee.findMany({
      where: { active: true },
      include: { skills: true, level: true, team: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.readinessOverride.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.availabilityEvent.findMany({ orderBy: { startDate: "asc" } }),
    prisma.request.findMany({ where: { type: "LEAVE", status: "APPROVED" }, select: { id: true, employeeId: true, payload: true } }),
    prisma.candidate.findMany({ include: { skills: true }, orderBy: [{ status: "asc" }, { lastName: "asc" }] }),
  ]);
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const employees = rawEmployees.map((e) => ({
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
    departmentId: e.departmentId,
    teamId: e.teamId,
    teamName: e.team?.name ?? null,
    levelName: e.level.name,
    rank: e.level.rank,
    contractEnd: e.contractEndDate ? ds(e.contractEndDate) : null,
    skills: new Map(e.skills.map((s) => [s.skillId, { proficiency: s.proficiency, expiresAt: s.expiresAt ? ds(s.expiresAt) : null }])),
  }));
  const absences = [
    ...events.map((ev) => ({
      id: ev.id,
      employeeId: ev.employeeId,
      type: ev.type as string,
      start: ds(ev.startDate),
      end: ev.endDate ? ds(ev.endDate) : null,
      note: ev.note,
      source: "EVENT" as const,
    })),
    ...leaveRequests.flatMap((r) => {
      const p = (r.payload ?? {}) as { from?: string; to?: string };
      if (!p.from) return [];
      return [{ id: r.id, employeeId: r.employeeId, type: "LEAVE", start: p.from, end: p.to ?? p.from, note: "Cerere de concediu aprobată", source: "REQUEST" as const }];
    }),
  ];
  return { departments, skills, skillById, levels, employees, overrides, absences, candidates };
}

// ---------------------------------------------------------------------------- helpers
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export const workdays = (calendarDays: number) => Math.max(0, Math.floor((calendarDays * 5) / 7));
export const calendarFromWorkdays = (wd: number) => Math.ceil((wd * 7) / 5);
export function roDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

/** Headcount a department needs: weekly person-hours of the staffing profile / 40h, +20% for rest days, leave and sickness. */
export function requiredHeadcount(dept: TeamData["departments"][number]) {
  const weekly = dept.staffing.reduce((a, s) => a + (s.endHour - s.startHour) * s.minStaff, 0);
  return Math.max(dept.teams.length, Math.ceil((weekly / 40) * 1.2));
}

/** The position whose requirements best describe what this person does (most demanding one they qualify for). */
export function rolePosition(data: TeamData, emp: TeamEmployee) {
  const dept = data.departments.find((d) => d.id === emp.departmentId)!;
  const qualified = dept.positions.filter((p) => p.skills.every((ps) => (emp.skills.get(ps.skillId)?.proficiency ?? 0) >= ps.minProficiency));
  const pool = qualified.length ? qualified : dept.positions;
  return [...pool].sort((a, b) => b.skills.reduce((x, s) => x + s.minProficiency, 0) - a.skills.reduce((x, s) => x + s.minProficiency, 0))[0] ?? null;
}

// ---------------------------------------------------------------------------- readiness
export type Reason = { color: Color; text: string; date?: string; kind: "LEAVES" | "ABSENCE" | "CERT" | "CONTRACT" | "OVERRIDE" };
export type Readiness = {
  employeeId: string;
  auto: Color;
  color: Color;
  reasons: Reason[];
  override: { color: Color; reason: string; validUntil: string | null; createdAt: string } | null;
  /** first day the person is no longer an employee (resignation / contract end) */
  leavesOn: string | null;
  leaveType: string | null;
  /** days absent inside the horizon (planned absences) */
  absentDays: number;
  /** first day of an absence inside the horizon */
  awayFrom: string | null;
  awayTo: string | null;
};

export function employeeReadiness(data: TeamData, emp: TeamEmployee, horizon: number, today = localDateStr(new Date())): Readiness {
  const end = addDaysStr(today, horizon - 1);
  const reasons: Reason[] = [];
  const evs = data.absences.filter((a) => a.employeeId === emp.id);

  // leaves for good
  let leavesOn: string | null = null;
  let leaveType: string | null = null;
  for (const a of evs) {
    if (a.end === null && (leavesOn === null || a.start < leavesOn)) {
      leavesOn = a.start;
      leaveType = a.type;
    }
  }
  if (emp.contractEnd) {
    const after = addDaysStr(emp.contractEnd, 1);
    if (leavesOn === null || after < leavesOn) {
      leavesOn = after;
      leaveType = "CONTRACT_END";
    }
  }
  if (leavesOn && leavesOn >= today) {
    const label = AVAILABILITY_LABELS[leaveType ?? "OTHER"].toLowerCase();
    if (leavesOn <= end) reasons.push({ color: "RED", kind: "LEAVES", date: leavesOn, text: `Pleacă din ${roDate(leavesOn)} (${label}).` });
    else if (daysBetween(end, leavesOn) <= 30) reasons.push({ color: "ORANGE", kind: "CONTRACT", date: leavesOn, text: `Pleacă la scurt timp după orizont: ${roDate(leavesOn)} (${label}).` });
  } else if (leavesOn && leavesOn < today) {
    reasons.push({ color: "RED", kind: "LEAVES", date: leavesOn, text: `Plecarea era programată pe ${roDate(leavesOn)} — actualizează fișa (inactiv).` });
  }

  // planned absences overlapping the horizon
  const absentSet = new Set<string>();
  let awayFrom: string | null = null;
  let awayTo: string | null = null;
  const absenceTexts: string[] = [];
  for (const a of evs) {
    if (a.end === null) continue;
    const s = a.start > today ? a.start : today;
    const e = a.end < end ? a.end : end;
    if (s > e) continue;
    for (let d = s; d <= e; d = addDaysStr(d, 1)) absentSet.add(d);
    if (!awayFrom || s < awayFrom) awayFrom = s;
    if (!awayTo || e > awayTo) awayTo = a.end;
    const t = `${AVAILABILITY_LABELS[a.type] ?? a.type} ${roDate(a.start)}–${roDate(a.end)}`;
    if (!absenceTexts.includes(t)) absenceTexts.push(t);
  }
  const absentDays = absentSet.size;
  if (absentDays > 0) {
    const long = absentDays >= Math.max(21, horizon / 2);
    reasons.push({
      color: long ? "RED" : "ORANGE",
      kind: "ABSENCE",
      date: awayFrom ?? undefined,
      text: `${absenceTexts.join("; ")} — ${absentDays} zile din următoarele ${horizon}.`,
    });
  }

  // mandatory certificates (required by a position of the department and held by the person)
  const dept = data.departments.find((d) => d.id === emp.departmentId);
  const mandatory = new Set(dept?.positions.flatMap((p) => p.skills.map((s) => s.skillId)) ?? []);
  for (const [skillId, s] of emp.skills) {
    const sk = data.skillById.get(skillId);
    if (!sk?.hasExpiry || !s.expiresAt || !mandatory.has(skillId)) continue;
    if (s.expiresAt < today) reasons.push({ color: "RED", kind: "CERT", date: s.expiresAt, text: `${sk.name} a expirat pe ${roDate(s.expiresAt)}.` });
    else if (daysBetween(today, s.expiresAt) <= 14) reasons.push({ color: "RED", kind: "CERT", date: s.expiresAt, text: `${sk.name} expiră pe ${roDate(s.expiresAt)} (sub 14 zile).` });
    else if (s.expiresAt <= end) reasons.push({ color: "ORANGE", kind: "CERT", date: s.expiresAt, text: `${sk.name} trebuie reînnoit până pe ${roDate(s.expiresAt)}.` });
  }

  const auto: Color = reasons.some((r) => r.color === "RED") ? "RED" : reasons.length ? "ORANGE" : "GREEN";
  const ov = data.overrides.find((o) => o.employeeId === emp.id && (!o.validUntil || ds(o.validUntil) >= today));
  const override = ov ? { color: ov.color as Color, reason: ov.reason, validUntil: ov.validUntil ? ds(ov.validUntil) : null, createdAt: ov.createdAt.toISOString() } : null;
  if (override) reasons.unshift({ color: override.color, kind: "OVERRIDE", text: `Setat manual: ${override.reason}` });
  return { employeeId: emp.id, auto, color: override?.color ?? auto, reasons, override, leavesOn, leaveType, absentDays, awayFrom, awayTo };
}

// ---------------------------------------------------------------------------- department balance
export type CriticalSkill = { skillId: string; code: string; name: string; greenHolders: number; holders: number; needed: number };
export type DeptBalance = {
  id: string;
  code: string;
  name: string;
  required: number;
  total: number;
  counts: Record<Color, number>;
  /** people you can count on (green + orange) minus required */
  margin: number;
  status: Color;
  critical: CriticalSkill[];
  teams: { id: string; name: string; counts: Record<Color, number>; hasLead: boolean }[];
};

export function departmentBalance(data: TeamData, readiness: Map<string, Readiness>): DeptBalance[] {
  return data.departments.map((d) => {
    const emps = data.employees.filter((e) => e.departmentId === d.id);
    const counts: Record<Color, number> = { GREEN: 0, ORANGE: 0, RED: 0 };
    for (const e of emps) counts[readiness.get(e.id)?.color ?? "GREEN"]++;
    const required = requiredHeadcount(d);
    const usable = counts.GREEN + counts.ORANGE;
    // a skill required by a position is critical when there are fewer green holders than rotating teams (one per shift)
    const needed = d.teams.length;
    const skillMin = new Map<string, number>();
    for (const p of d.positions) for (const s of p.skills) skillMin.set(s.skillId, Math.min(skillMin.get(s.skillId) ?? 9, s.minProficiency));
    const critical: CriticalSkill[] = [];
    for (const [skillId, minP] of skillMin) {
      const holders = emps.filter((e) => (e.skills.get(skillId)?.proficiency ?? 0) >= minP);
      const greenHolders = holders.filter((e) => readiness.get(e.id)?.color === "GREEN").length;
      const sk = data.skillById.get(skillId)!;
      if (greenHolders < needed) critical.push({ skillId, code: sk.code, name: sk.name, greenHolders, holders: holders.length, needed });
    }
    const teams = d.teams.map((t) => {
      const members = emps.filter((e) => e.teamId === t.id);
      const c: Record<Color, number> = { GREEN: 0, ORANGE: 0, RED: 0 };
      for (const m of members) c[readiness.get(m.id)?.color ?? "GREEN"]++;
      return { id: t.id, name: t.name, counts: c, hasLead: members.some((m) => m.rank >= 3 && readiness.get(m.id)?.color !== "RED") };
    });
    const status: Color =
      usable < required || critical.some((c) => c.greenHolders === 0) ? "RED" : counts.GREEN < required || critical.length > 0 || teams.some((t) => !t.hasLead) ? "ORANGE" : "GREEN";
    return { id: d.id, code: d.code, name: d.name, required, total: emps.length, counts, margin: usable - required, status, critical, teams };
  });
}

export function computeAll(data: TeamData, horizon: number, today = localDateStr(new Date())) {
  const readiness = new Map(data.employees.map((e) => [e.id, employeeReadiness(data, e, horizon, today)]));
  return { readiness, balance: departmentBalance(data, readiness), today, horizon };
}

/** Everything the ReadinessPanel needs for one person (serialisable). */
export function panelProps(data: TeamData, employeeId: string, horizon: number) {
  const emp = data.employees.find((e) => e.id === employeeId);
  if (!emp) return null;
  const r = employeeReadiness(data, emp, horizon);
  const events = data.absences
    .filter((a) => a.employeeId === employeeId)
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((a) => ({ id: a.id, type: a.type, start: a.start, end: a.end, note: a.note, source: a.source as "EVENT" | "REQUEST" | "CONTRACT" }));
  if (emp.contractEnd && !events.some((e) => e.type === "CONTRACT_END"))
    events.unshift({ id: "contract", type: "CONTRACT_END", start: addDaysStr(emp.contractEnd, 1), end: null, note: "Din fișa angajatului (final contract)", source: "CONTRACT" as "EVENT" | "REQUEST" | "CONTRACT" });
  return {
    employeeId,
    horizon,
    color: r.color,
    auto: r.auto,
    reasons: r.reasons.map((x) => ({ color: x.color, text: x.text })),
    override: r.override ? { color: r.override.color, reason: r.override.reason, validUntil: r.override.validUntil } : null,
    events,
    labels: AVAILABILITY_LABELS,
  };
}
