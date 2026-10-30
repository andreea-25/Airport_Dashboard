import { prisma } from "../db";
import { applyChangeToData, cloneData, SimError } from "./changes";
import { compare, evaluate, type Comparison } from "./evaluate";
import { changeSchema } from "./schema";
import type { Change, Evaluation, SimData, SimEmployee, SimOverride, SimShift } from "./types";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type Reference = Omit<SimData, "periodStart" | "periodEnd" | "shifts" | "overrides">;

async function loadReference(): Promise<Reference> {
  const [employees, positions, staffing, departments, teams, levels, skills] = await Promise.all([
    prisma.employee.findMany({ include: { level: true, skills: true } }),
    prisma.position.findMany({ include: { skills: true } }),
    prisma.staffingRequirement.findMany(),
    prisma.department.findMany(),
    prisma.team.findMany(),
    prisma.level.findMany(),
    prisma.skill.findMany(),
  ]);
  const emps: Record<string, SimEmployee> = {};
  for (const e of employees) {
    emps[e.id] = {
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      departmentId: e.departmentId,
      teamId: e.teamId,
      levelId: e.levelId,
      levelRank: e.level.rank,
      levelName: e.level.name,
      skills: Object.fromEntries(e.skills.map((s) => [s.skillId, { proficiency: s.proficiency, expiresAt: s.expiresAt }])),
    };
  }
  return {
    employees: emps,
    positions: Object.fromEntries(
      positions.map((p) => [p.id, { id: p.id, name: p.name, departmentId: p.departmentId, skills: p.skills.map((s) => ({ skillId: s.skillId, minProficiency: s.minProficiency })) }]),
    ),
    staffing: staffing.map((s) => ({ departmentId: s.departmentId, dayOfWeek: s.dayOfWeek, startHour: s.startHour, endHour: s.endHour, minStaff: s.minStaff })),
    departments: Object.fromEntries(departments.map((d) => [d.id, { id: d.id, name: d.name, code: d.code }])),
    teams: Object.fromEntries(teams.map((t) => [t.id, { id: t.id, name: t.name, departmentId: t.departmentId }])),
    levels: Object.fromEntries(levels.map((l) => [l.id, { id: l.id, name: l.name, rank: l.rank }])),
    skills: Object.fromEntries(skills.map((s) => [s.id, { id: s.id, name: s.name, code: s.code, type: s.type }])),
  };
}

function applyOverrides(ref: Reference, overrides: Record<string, SimOverride>) {
  for (const [empId, o] of Object.entries(overrides)) {
    const e = ref.employees[empId];
    if (!e) continue;
    if (o.teamId) e.teamId = o.teamId;
    if (o.departmentId) e.departmentId = o.departmentId;
    if (o.levelId && ref.levels[o.levelId]) {
      e.levelId = o.levelId;
      e.levelRank = ref.levels[o.levelId].rank;
      e.levelName = ref.levels[o.levelId].name;
    }
  }
}

/** Real schedule for a period, in the same shape as a scenario. */
export async function loadRealData(periodStart: Date, periodEnd: Date): Promise<SimData> {
  const ref = await loadReference();
  const shifts = await prisma.shift.findMany({
    where: { startAt: { lt: periodEnd }, endAt: { gt: periodStart } },
    include: { assignments: true },
    orderBy: { startAt: "asc" },
  });
  return {
    ...ref,
    periodStart,
    periodEnd,
    overrides: {},
    shifts: shifts.map((s) => ({
      id: s.id,
      sourceShiftId: s.id,
      departmentId: s.departmentId,
      teamId: s.teamId,
      startAt: s.startAt,
      endAt: s.endAt,
      assignments: s.assignments.map((a) => ({ id: a.id, employeeId: a.employeeId, positionId: a.positionId, isLead: a.isLead })),
    })),
  };
}

export async function loadScenarioData(scenarioId: string): Promise<SimData> {
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: { shifts: { include: { assignments: true }, orderBy: { startAt: "asc" } }, overrides: true },
  });
  if (!scenario) throw new SimError("Scenariu inexistent");
  const ref = await loadReference();
  const overrides: Record<string, SimOverride> = Object.fromEntries(
    scenario.overrides.map((o) => [o.employeeId, { teamId: o.teamId, departmentId: o.departmentId, levelId: o.levelId }]),
  );
  applyOverrides(ref, overrides);
  return {
    ...ref,
    periodStart: scenario.periodStart,
    periodEnd: scenario.periodEnd,
    overrides,
    shifts: scenario.shifts.map((s) => ({
      id: s.id,
      sourceShiftId: s.sourceShiftId,
      departmentId: s.departmentId,
      teamId: s.teamId,
      startAt: s.startAt,
      endAt: s.endAt,
      assignments: s.assignments.map((a) => ({ id: a.id, employeeId: a.employeeId, positionId: a.positionId, isLead: a.isLead })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Persistence (scenario tables only — real tables are never written here)
// ---------------------------------------------------------------------------

type Snapshot = {
  shifts: { id: string; sourceShiftId: string | null; departmentId: string; teamId: string | null; startAt: string; endAt: string; assignments: SimShift["assignments"] }[];
  overrides: Record<string, SimOverride>;
};

function snapshot(data: SimData): Snapshot {
  return {
    shifts: data.shifts.map((s) => ({
      id: s.id,
      sourceShiftId: s.sourceShiftId ?? null,
      departmentId: s.departmentId,
      teamId: s.teamId,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      assignments: s.assignments,
    })),
    overrides: data.overrides,
  };
}

async function writeSnapshot(scenarioId: string, snap: Snapshot) {
  await prisma.$transaction(async (tx) => {
    await tx.scenarioAssignment.deleteMany({ where: { scenarioId } });
    await tx.scenarioShift.deleteMany({ where: { scenarioId } });
    await tx.scenarioEmployeeOverride.deleteMany({ where: { scenarioId } });
    await tx.scenarioShift.createMany({
      data: snap.shifts.map((s) => ({
        id: s.id,
        scenarioId,
        sourceShiftId: s.sourceShiftId,
        departmentId: s.departmentId,
        teamId: s.teamId,
        startAt: new Date(s.startAt),
        endAt: new Date(s.endAt),
      })),
    });
    await tx.scenarioAssignment.createMany({
      data: snap.shifts.flatMap((s) =>
        s.assignments.map((a) => ({ id: a.id, scenarioId, scenarioShiftId: s.id, employeeId: a.employeeId, positionId: a.positionId, isLead: a.isLead })),
      ),
    });
    const ov = Object.entries(snap.overrides);
    if (ov.length) {
      await tx.scenarioEmployeeOverride.createMany({
        data: ov.map(([employeeId, o]) => ({ scenarioId, employeeId, teamId: o.teamId ?? null, departmentId: o.departmentId ?? null, levelId: o.levelId ?? null })),
      });
    }
  }, { timeout: 30_000 });
}

/** Copy the real shifts of a period into a new scenario. */
export async function createScenarioFromReal(input: { name: string; createdById: string; periodStart: Date; periodEnd: Date; notes?: string }) {
  const real = await loadRealData(input.periodStart, input.periodEnd);
  const scenario = await prisma.scenario.create({
    data: { name: input.name, createdById: input.createdById, periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes },
  });
  const snap = snapshot(real);
  // fresh ids for the copies, keep the link to the real shift
  for (const s of snap.shifts) {
    s.sourceShiftId = s.id;
    s.id = `ss_${globalThis.crypto.randomUUID()}`;
    s.assignments = s.assignments.map((a) => ({ ...a, id: `sa_${globalThis.crypto.randomUUID()}` }));
  }
  await writeSnapshot(scenario.id, snap);
  return scenario;
}

export async function duplicateScenario(scenarioId: string, createdById: string, name?: string) {
  const src = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!src) throw new SimError("Scenariu inexistent");
  const data = await loadScenarioData(scenarioId);
  const copy = await prisma.scenario.create({
    data: { name: name ?? `${src.name} (copie)`, createdById, periodStart: src.periodStart, periodEnd: src.periodEnd, notes: src.notes },
  });
  const snap = snapshot(data);
  for (const s of snap.shifts) {
    s.id = `ss_${globalThis.crypto.randomUUID()}`;
    s.assignments = s.assignments.map((a) => ({ ...a, id: `sa_${globalThis.crypto.randomUUID()}` }));
  }
  await writeSnapshot(copy.id, snap);
  return copy;
}

/** Validate + apply a change, record it in ScenarioChange (with an undo snapshot), persist. */
export async function applyChange(scenarioId: string, rawChange: unknown): Promise<{ message: string; evaluation: Evaluation }> {
  const parsed = changeSchema.safeParse(rawChange);
  if (!parsed.success) throw new SimError(`Modificare invalidă: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const change = parsed.data as Change;
  const data = await loadScenarioData(scenarioId);
  const before = snapshot(data);
  const message = applyChangeToData(data, change);
  await writeSnapshot(scenarioId, snapshot(data));
  await prisma.scenarioChange.create({
    data: { scenarioId, type: change.type, payload: { ...change, message } as object, inverse: before as unknown as object },
  });
  return { message, evaluation: evaluate(data) };
}

export async function undoLastChange(scenarioId: string) {
  const last = await prisma.scenarioChange.findFirst({ where: { scenarioId }, orderBy: { createdAt: "desc" } });
  if (!last || !last.inverse) throw new SimError("Nu există modificări de anulat");
  await writeSnapshot(scenarioId, last.inverse as unknown as Snapshot);
  await prisma.scenarioChange.delete({ where: { id: last.id } });
  return last;
}

/** Run a change on a temporary copy and report the impact. Nothing is stored. */
export async function previewChanges(scenarioId: string, rawChanges: unknown[]) {
  const data = await loadScenarioData(scenarioId);
  const before = evaluate(data);
  const copy = cloneData(data);
  const messages: string[] = [];
  for (const raw of rawChanges) {
    const parsed = changeSchema.safeParse(raw);
    if (!parsed.success) throw new SimError(`Modificare invalidă: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    messages.push(applyChangeToData(copy, parsed.data as Change));
  }
  const after = evaluate(copy);
  return { messages, impact: compare(before, after) };
}

export async function evaluateScenario(scenarioId: string) {
  return evaluate(await loadScenarioData(scenarioId));
}

export async function evaluateReal(periodStart: Date, periodEnd: Date) {
  return evaluate(await loadRealData(periodStart, periodEnd));
}

/** Compare scenario A with scenario B, or with the real schedule of A's period. */
export async function compareScenarios(aId: string, b: string | "real"): Promise<{ a: Evaluation; b: Evaluation; diff: Comparison }> {
  const scenarioA = await prisma.scenario.findUnique({ where: { id: aId } });
  if (!scenarioA) throw new SimError("Scenariu inexistent");
  const evA = await evaluateScenario(aId);
  const evB = b === "real" ? await evaluateReal(scenarioA.periodStart, scenarioA.periodEnd) : await evaluateScenario(b);
  // diff is expressed as "b -> a": how the scenario differs from the reference
  return { a: evA, b: evB, diff: compare(evB, evA) };
}

// ---------------------------------------------------------------------------
// Skill gap
// ---------------------------------------------------------------------------

export type SkillGapItem = {
  skillId: string;
  skillName: string;
  type: string;
  required: number;
  current: number;
  expired: boolean;
  expiresAt: string | null;
  ok: boolean;
};

export type SkillGap = {
  employeeId: string;
  employeeName: string;
  currentLevel: string;
  targetLevel: string | null;
  targetDepartment: string;
  items: SkillGapItem[];
  monthsRequired: number;
  monthsInLevel: number;
  monthsOk: boolean;
  ready: boolean;
};

/**
 * What an employee lacks to reach a target level (default: next level) in their department,
 * or to move into another department at their current level.
 * `overrides` lets the simulation evaluate a gap with the scenario's version of the employee.
 */
export async function skillGap(
  employeeId: string,
  target: { targetLevelId?: string | null; targetDepartmentId?: string | null } = {},
  overrides?: SimOverride,
): Promise<SkillGap> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { level: true, skills: { include: { skill: true } } } });
  if (!emp) throw new SimError("Angajat inexistent");
  const levels = await prisma.level.findMany({ orderBy: { rank: "asc" } });
  const currentLevel = (overrides?.levelId && levels.find((l) => l.id === overrides.levelId)) || emp.level;
  const deptId = target.targetDepartmentId ?? overrides?.departmentId ?? emp.departmentId;
  let targetLevel = target.targetLevelId ? levels.find((l) => l.id === target.targetLevelId) : null;
  if (!targetLevel && !target.targetDepartmentId) targetLevel = levels.find((l) => l.rank === currentLevel.rank + 1) ?? null;
  const dept = await prisma.department.findUnique({ where: { id: deptId } });

  // For a department move at the same level we use that department's requirements for the current level
  // (or, for Agent I, the skills its positions need).
  const lookupLevel = targetLevel ?? currentLevel;
  let reqs = await prisma.levelRequirement.findMany({ where: { departmentId: deptId, levelId: lookupLevel.id }, include: { skill: true } });
  let monthsRequired = targetLevel ? reqs[0]?.minMonthsInPrevLevel ?? 0 : 0;
  if (!reqs.length) {
    const posSkills = await prisma.positionSkill.findMany({ where: { position: { departmentId: deptId } }, include: { skill: true } });
    const m = new Map<string, (typeof posSkills)[number]>();
    for (const p of posSkills) if (!m.has(p.skillId) || m.get(p.skillId)!.minProficiency < p.minProficiency) m.set(p.skillId, p);
    reqs = [...m.values()].map((p) => ({ id: p.skillId, departmentId: deptId, levelId: lookupLevel.id, skillId: p.skillId, minProficiency: p.minProficiency, minMonthsInPrevLevel: 0, skill: p.skill }));
    monthsRequired = 0;
  }
  const now = new Date();
  const items: SkillGapItem[] = reqs.map((r) => {
    const have = emp.skills.find((s) => s.skillId === r.skillId);
    const expired = !!have?.expiresAt && have.expiresAt < now;
    return {
      skillId: r.skillId,
      skillName: r.skill.name,
      type: r.skill.type,
      required: r.minProficiency,
      current: have?.proficiency ?? 0,
      expired,
      expiresAt: have?.expiresAt?.toISOString() ?? null,
      ok: !!have && have.proficiency >= r.minProficiency && !expired,
    };
  });
  items.sort((a, b) => Number(a.ok) - Number(b.ok));
  const monthsInLevel = Math.floor((now.getTime() - emp.levelSince.getTime()) / (30.44 * 86400000));
  const monthsOk = monthsInLevel >= monthsRequired;
  return {
    employeeId,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    currentLevel: currentLevel.name,
    targetLevel: targetLevel?.name ?? null,
    targetDepartment: dept?.name ?? "",
    items,
    monthsRequired,
    monthsInLevel,
    monthsOk,
    ready: monthsOk && items.every((i) => i.ok),
  };
}

export { SimError };
