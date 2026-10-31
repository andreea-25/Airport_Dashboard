// Former employees (inactive) and "what if we hired them again?".
// For each department: closest position, training / certificate renewals needed, and the effect on the
// department's balance (semafor) if the person came back.
import { prisma } from "@/lib/db";
import { addDaysStr, localDateStr } from "@/lib/time";
import { calendarFromWorkdays, computeAll, type Color, type TeamData, type TeamEmployee } from "./readiness";
import { gapDays, gapFor, gapText } from "./replacement";

export const LEAVE_REASONS: Record<string, string> = {
  RESIGNATION: "Demisie",
  CONTRACT_END: "Final de contract",
  RETIREMENT: "Pensionare",
  OTHER: "Alt motiv",
};

export async function loadFormerEmployees() {
  return prisma.employee.findMany({
    where: { active: false },
    include: { skills: { include: { skill: true } }, level: true, department: true, team: true },
    orderBy: [{ leftAt: "desc" }, { lastName: "asc" }],
  });
}
export type FormerEmployee = Awaited<ReturnType<typeof loadFormerEmployees>>[number];

const ds = (d: Date) => d.toISOString().slice(0, 10);

export function expiredCerts(f: FormerEmployee, today = localDateStr(new Date())) {
  return f.skills.filter((s) => s.skill.hasExpiry && s.expiresAt && ds(s.expiresAt) < today).map((s) => s.skill.name);
}

export type RehireDept = {
  departmentId: string;
  code: string;
  name: string;
  previous: boolean;
  position: string | null;
  trainingDays: number;
  missing: string;
  readyBy: string;
  before: { margin: number; status: Color };
  after: { margin: number; status: Color };
  teams: { id: string; name: string; green: number; hasLead: boolean }[];
  suggestedTeamId: string | null;
};

export function rehireAnalysis(data: TeamData, f: FormerEmployee, horizon = 60) {
  const today = localDateStr(new Date());
  const validUntil = addDaysStr(today, horizon);
  const skills = new Map(f.skills.map((s) => [s.skillId, { proficiency: s.proficiency, expiresAt: s.expiresAt ? ds(s.expiresAt) : null }]));
  // for the "after" picture we assume the renewals are done before the person starts
  const renewed = new Map([...skills].map(([k, v]) => [k, { ...v, expiresAt: v.expiresAt && v.expiresAt < validUntil ? null : v.expiresAt }]));
  const base = computeAll(data, horizon, today).balance;
  const asEmployee = (departmentId: string, teamId: string | null): TeamEmployee => ({
    id: f.id,
    name: `${f.firstName} ${f.lastName}`,
    departmentId,
    teamId,
    teamName: data.departments.find((d) => d.id === departmentId)?.teams.find((t) => t.id === teamId)?.name ?? null,
    levelName: f.level.name,
    rank: f.level.rank,
    contractEnd: null,
    skills: renewed,
  });

  const depts: RehireDept[] = data.departments.map((d) => {
    // most demanding position reachable with little training (a former controller goes back to controlling,
    // not to the assistant post), otherwise the one with the least training
    const opts = d.positions.map((p) => ({
      p,
      weight: p.skills.reduce((a, s) => a + s.minProficiency, 0),
      gap: gapFor(data, skills, p.skills.map((s) => ({ skillId: s.skillId, min: s.minProficiency })), validUntil),
    }));
    const minGap = Math.min(...opts.map((o) => gapDays(o.gap)));
    const best = [...opts].filter((o) => gapDays(o.gap) <= minGap + 15).sort((a, b) => b.weight - a.weight)[0];
    const b = base.find((x) => x.id === d.id)!;
    // team that needs the person most: fewest green people (prefer the old team on ties)
    const teams = b.teams.map((t) => ({ id: t.id, name: t.name, green: t.counts.GREEN, hasLead: t.hasLead }));
    const suggestedTeam =
      [...teams].sort((x, y) => Number(x.hasLead) - Number(y.hasLead) || x.green - y.green || Number(y.id === f.teamId) - Number(x.id === f.teamId))[0] ?? null;
    const after = computeAll({ ...data, employees: [...data.employees, asEmployee(d.id, suggestedTeam?.id ?? null)] }, horizon, today).balance.find((x) => x.id === d.id)!;
    const days = best ? gapDays(best.gap) : 0;
    return {
      departmentId: d.id,
      code: d.code,
      name: d.name,
      previous: d.id === f.departmentId,
      position: best?.p.name ?? null,
      trainingDays: days,
      missing: best ? gapText(best.gap) : "",
      readyBy: addDaysStr(today, calendarFromWorkdays(days)),
      before: { margin: b.margin, status: b.status },
      after: { margin: after.margin, status: after.status },
      teams,
      suggestedTeamId: suggestedTeam?.id ?? null,
    };
  });
  // suggestion: where the person is needed and can start soon; the old department gets a bonus
  const score = (x: RehireDept) => (x.previous ? 3 : 0) + (x.before.margin < 0 ? 4 : x.before.margin === 0 ? 1 : 0) + (x.before.status === "RED" ? 1 : 0) - x.trainingDays / 10;
  const ranked = [...depts].filter((x) => x.trainingDays <= 30 || x.previous).sort((a, b) => score(b) - score(a));
  return { depts: [...depts].sort((a, b) => score(b) - score(a)), suggested: ranked[0]?.departmentId ?? f.departmentId };
}
