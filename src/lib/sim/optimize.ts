import { localInfo } from "../time";
import { applyChangeToData, bestPosition, cloneData, isAbsent, qualifiesFor } from "./changes";
import { evaluate } from "./evaluate";
import type { Change, Evaluation, SimData, SimShift } from "./types";

/**
 * Deterministic optimizer. It generates many small candidate changes from what is wrong in the
 * current evaluation (gaps, missing leads, rule violations, unqualified people), evaluates every
 * candidate on a copy with the simulation engine, and keeps the ones that raise the score.
 * No AI involved — the AI only chooses among / explains these candidates.
 */

export type Candidate = {
  id: string;
  kind: "ADD" | "MOVE" | "SHIFT_HOURS" | "LEAD" | "POSITION" | "REMOVE" | "REPLACE";
  changes: Change[];
  description: string;
  employeeIds: string[];
  departmentId: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  impact: { coverage: [number, number]; understaffed: [number, number]; violations: [number, number]; overtime: [number, number]; mismatches: [number, number] };
};

export type OptimizeOptions = {
  limit?: number;
  departmentId?: string | null;
  excludeEmployeeIds?: string[];
  maxEvaluations?: number;
};

type Draft = Omit<Candidate, "id" | "scoreBefore" | "scoreAfter" | "delta" | "impact">;

const HOUR = 3_600_000;

const missingText = (n: number) => (n === 1 ? "lipsește 1 om" : `lipsesc ${n} oameni`);

function shiftLabel(data: SimData, s: SimShift) {
  const i = localInfo(s.startAt);
  return `${data.departments[s.departmentId]?.code} ${i.date.slice(8)}.${i.date.slice(5, 7)} ${i.time}–${localInfo(s.endAt).time}`;
}

/** Coverage of each shift: the worst hour and how many people are missing / extra over its hours. */
function shiftCoverage(data: SimData, ev: Evaluation) {
  const bySlot = new Map<string, { required: number; assigned: number }>();
  for (const c of ev.coverage) bySlot.set(`${c.departmentId}|${new Date(c.slotStart).getTime()}`, c);
  const out = new Map<string, { deficit: number; surplus: number; required: number; deficitBeforeStart: number }>();
  for (const s of data.shifts) {
    let deficit = 0;
    let surplus = Infinity;
    let required = 0;
    for (let t = s.startAt.getTime(); t < s.endAt.getTime(); t += HOUR) {
      const c = bySlot.get(`${s.departmentId}|${t}`);
      if (!c) continue;
      required = Math.max(required, c.required);
      deficit = Math.max(deficit, c.required - c.assigned);
      surplus = Math.min(surplus, c.assigned - c.required);
    }
    const before = bySlot.get(`${s.departmentId}|${s.startAt.getTime() - HOUR}`);
    out.set(s.id, {
      deficit,
      surplus: surplus === Infinity ? 0 : Math.max(0, surplus),
      required,
      deficitBeforeStart: before ? Math.max(0, before.required - before.assigned) : 0,
    });
  }
  return out;
}

export function findImprovements(data: SimData, opts: OptimizeOptions = {}): { base: Evaluation; candidates: Candidate[]; evaluated: number } {
  const limit = opts.limit ?? 10;
  const maxEval = opts.maxEvaluations ?? 220;
  const exclude = new Set(opts.excludeEmployeeIds ?? []);
  const rules = data.settings.rules;
  const base = evaluate(data);
  const cov = shiftCoverage(data, base);
  const inScope = (s: SimShift) => !opts.departmentId || s.departmentId === opts.departmentId;

  // employee -> their shifts (for rest / weekly-hours checks)
  const empShifts = new Map<string, SimShift[]>();
  for (const s of data.shifts) for (const a of s.assignments) (empShifts.get(a.employeeId) ?? empShifts.set(a.employeeId, []).get(a.employeeId)!).push(s);
  const weekHours = (empId: string, monday: string) =>
    (empShifts.get(empId) ?? []).filter((x) => localInfo(x.startAt).monday === monday).reduce((acc, x) => acc + (x.endAt.getTime() - x.startAt.getTime()) / HOUR, 0);
  const totalHours = (empId: string) => (empShifts.get(empId) ?? []).reduce((acc, x) => acc + (x.endAt.getTime() - x.startAt.getTime()) / HOUR, 0);

  /** People of the department who can take this shift without breaking rest / weekly limits. */
  const freeFor = (s: SimShift, seniorOnly = false) => {
    const restMs = rules.minRestHours * HOUR;
    const len = (s.endAt.getTime() - s.startAt.getTime()) / HOUR;
    const info = localInfo(s.startAt);
    return Object.values(data.employees)
      .filter((e) => e.departmentId === s.departmentId && !exclude.has(e.id) && (!seniorOnly || e.levelRank >= rules.leadMinRank))
      .filter((e) => !isAbsent(data, e.id, info.date))
      .filter((e) =>
        (empShifts.get(e.id) ?? []).every((x) => x.endAt.getTime() + restMs <= s.startAt.getTime() || x.startAt.getTime() >= s.endAt.getTime() + restMs),
      )
      .filter((e) => weekHours(e.id, info.monday) + len <= rules.normalWeeklyHours)
      .map((e) => ({ e, qualified: Object.values(data.positions).some((p) => p.departmentId === s.departmentId && qualifiesFor(data, e, p.id, s.startAt)) }))
      .sort((a, b) => Number(b.qualified) - Number(a.qualified) || totalHours(a.e.id) - totalHours(b.e.id) || b.e.levelRank - a.e.levelRank)
      .map((x) => x.e);
  };

  const drafts: Draft[] = [];
  const name = (id: string) => data.employees[id]?.name ?? id;

  // 1) understaffed shifts: add a free person, or move one from an overstaffed shift the same day
  const short = data.shifts.filter((s) => inScope(s) && (cov.get(s.id)?.deficit ?? 0) > 0).sort((a, b) => cov.get(b.id)!.deficit - cov.get(a.id)!.deficit);
  for (const s of short.slice(0, 25)) {
    for (const e of freeFor(s).slice(0, 2)) {
      drafts.push({ kind: "ADD", changes: [{ type: "ADD_ASSIGNMENT", shiftId: s.id, employeeId: e.id, positionId: bestPosition(data, e, s.departmentId, s.startAt) }], description: `Adaugă pe ${e.name} în tura ${shiftLabel(data, s)} (${missingText(cov.get(s.id)!.deficit)})`, employeeIds: [e.id], departmentId: s.departmentId });
    }
    const day = localInfo(s.startAt).date;
    const donors = data.shifts.filter((d) => d.id !== s.id && d.departmentId === s.departmentId && localInfo(d.startAt).date === day && (cov.get(d.id)?.surplus ?? 0) > 0);
    for (const d of donors.slice(0, 2)) {
      const a = d.assignments.filter((x) => !x.isLead && !exclude.has(x.employeeId) && !s.assignments.some((y) => y.employeeId === x.employeeId)).sort((x, y) => (data.employees[x.employeeId]?.levelRank ?? 0) - (data.employees[y.employeeId]?.levelRank ?? 0))[0];
      if (!a) continue;
      drafts.push({ kind: "MOVE", changes: [{ type: "MOVE_ASSIGNMENT", assignmentId: a.id, toShiftId: s.id }], description: `Mută pe ${name(a.employeeId)} din ${shiftLabel(data, d)} (surplus) în ${shiftLabel(data, s)}`, employeeIds: [a.employeeId], departmentId: s.departmentId });
    }
  }

  // 2) gaps right before a shift starts (e.g. 05:00 wave, shift starts 06:00): start one hour earlier
  const earlyDepts = new Set<string>();
  for (const s of data.shifts.filter((x) => inScope(x) && (cov.get(x.id)?.deficitBeforeStart ?? 0) > 0)) {
    const st = localInfo(s.startAt);
    const newStart = localInfo(s.startAt.getTime() - HOUR).time;
    const newEnd = localInfo(s.endAt.getTime() - HOUR).time;
    const key = `${s.departmentId}|${st.time}`;
    if (!earlyDepts.has(key)) {
      earlyDepts.add(key);
      drafts.push({ kind: "SHIFT_HOURS", changes: [{ type: "CHANGE_SHIFT_HOURS", departmentId: s.departmentId, fromStart: st.time, startTime: newStart, endTime: newEnd }], description: `${data.departments[s.departmentId]?.name}: toate turele de la ${st.time} încep cu o oră mai devreme (${newStart}–${newEnd})`, employeeIds: [], departmentId: s.departmentId });
      if (s.teamId) {
        drafts.push({ kind: "SHIFT_HOURS", changes: [{ type: "CHANGE_SHIFT_HOURS", departmentId: s.departmentId, teamId: s.teamId, fromStart: st.time, startTime: newStart, endTime: newEnd }], description: `${data.departments[s.departmentId]?.name}, ${data.teams[s.teamId]?.name}: turele de la ${st.time} trec pe ${newStart}–${newEnd}`, employeeIds: [], departmentId: s.departmentId });
      }
    }
  }

  // 3) shifts without a lead
  for (const v of base.violations.filter((x) => x.type === "NO_LEAD" && x.shiftId).slice(0, 15)) {
    const s = data.shifts.find((x) => x.id === v.shiftId);
    if (!s || !inScope(s)) continue;
    const e = freeFor(s, true)[0];
    if (e) drafts.push({ kind: "LEAD", changes: [{ type: "ADD_ASSIGNMENT", shiftId: s.id, employeeId: e.id, positionId: bestPosition(data, e, s.departmentId, s.startAt), isLead: true }], description: `Tura ${shiftLabel(data, s)} nu are lider: adaugă pe ${e.name} (${e.levelName}) ca lider`, employeeIds: [e.id], departmentId: s.departmentId });
    const day = localInfo(s.startAt).date;
    for (const d of data.shifts.filter((x) => x.id !== s.id && x.departmentId === s.departmentId && localInfo(x.startAt).date === day)) {
      const seniors = d.assignments.filter((a) => (data.employees[a.employeeId]?.levelRank ?? 0) >= rules.leadMinRank && !exclude.has(a.employeeId));
      if (seniors.length >= 2) {
        const a = seniors.find((x) => !x.isLead) ?? seniors[1];
        drafts.push({ kind: "LEAD", changes: [{ type: "MOVE_ASSIGNMENT", assignmentId: a.id, toShiftId: s.id }], description: `Mută pe ${name(a.employeeId)} (${data.employees[a.employeeId]?.levelName}) din ${shiftLabel(data, d)}, care are 2 lideri, în ${shiftLabel(data, s)}, fără lider`, employeeIds: [a.employeeId], departmentId: s.departmentId });
        break;
      }
    }
  }

  // 4) people on a position they're not qualified for: switch position, or replace them
  for (const m of base.skillMismatches.slice(0, 20)) {
    const s = data.shifts.find((x) => x.id === m.shiftId);
    if (!s || !inScope(s) || exclude.has(m.employeeId)) continue;
    const a = s.assignments.find((x) => x.employeeId === m.employeeId);
    const emp = data.employees[m.employeeId];
    if (!a || !emp) continue;
    const pos = Object.values(data.positions).find((p) => p.departmentId === s.departmentId && p.id !== a.positionId && qualifiesFor(data, emp, p.id, s.startAt));
    if (pos) {
      drafts.push({ kind: "POSITION", changes: [{ type: "SET_ASSIGNMENT", assignmentId: a.id, positionId: pos.id }], description: `${emp.name} nu are ${m.missingSkills.join(", ")} pentru „${m.positionName}”: trece pe postul „${pos.name}” (${shiftLabel(data, s)})`, employeeIds: [emp.id], departmentId: s.departmentId });
    } else {
      const sub = freeFor(s).find((e) => a.positionId && qualifiesFor(data, e, a.positionId, s.startAt));
      if (sub) drafts.push({ kind: "REPLACE", changes: [{ type: "REMOVE_ASSIGNMENT", assignmentId: a.id }, { type: "ADD_ASSIGNMENT", shiftId: s.id, employeeId: sub.id, positionId: a.positionId }], description: `Înlocuiește pe ${emp.name} (fără ${m.missingSkills.join(", ")}) cu ${sub.name} pe „${m.positionName}”, ${shiftLabel(data, s)}`, employeeIds: [emp.id, sub.id], departmentId: s.departmentId });
    }
  }

  // 5) rule violations of a person (rest, weekly hours, absent): take them off one shift, replacing them if needed
  const seen = new Set<string>();
  for (const v of base.violations.filter((x) => (x.type === "REST_TOO_SHORT" || x.type === "WEEKLY_HOURS" || x.type === "ABSENT_ASSIGNED") && x.employeeId)) {
    const empId = v.employeeId!;
    if (exclude.has(empId)) continue;
    const list = (empShifts.get(empId) ?? []).filter(inScope);
    const target = v.shiftId ? list.find((x) => x.id === v.shiftId) : [...list].sort((x, y) => (cov.get(y.id)?.surplus ?? 0) - (cov.get(x.id)?.surplus ?? 0))[0];
    if (!target || seen.has(`${empId}|${target.id}`)) continue;
    seen.add(`${empId}|${target.id}`);
    const a = target.assignments.find((x) => x.employeeId === empId)!;
    const why = v.type === "REST_TOO_SHORT" ? "repaus prea scurt" : v.type === "WEEKLY_HOURS" ? `peste ${rules.maxWeeklyHours}h/săptămână` : "e absent(ă)";
    if ((cov.get(target.id)?.surplus ?? 0) > 0 || v.type === "ABSENT_ASSIGNED") {
      drafts.push({ kind: "REMOVE", changes: [{ type: "REMOVE_ASSIGNMENT", assignmentId: a.id }], description: `${name(empId)} (${why}) iese din tura ${shiftLabel(data, target)}`, employeeIds: [empId], departmentId: target.departmentId });
    }
    const sub = freeFor(target).find((e) => e.id !== empId);
    if (sub) drafts.push({ kind: "REPLACE", changes: [{ type: "REMOVE_ASSIGNMENT", assignmentId: a.id }, { type: "ADD_ASSIGNMENT", shiftId: target.id, employeeId: sub.id, positionId: a.positionId, isLead: a.isLead }], description: `${name(empId)} (${why}) e înlocuit(ă) de ${sub.name} în tura ${shiftLabel(data, target)}`, employeeIds: [empId, sub.id], departmentId: target.departmentId });
    if (seen.size > 25) break;
  }

  // ---- evaluate every draft on a copy ----
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const uniq = new Map<string, Draft>();
  for (const d of drafts) uniq.set(JSON.stringify(d.changes), d);
  const scored: Omit<Candidate, "id">[] = [];
  let evaluated = 0;
  for (const d of uniq.values()) {
    if (evaluated >= maxEval) break;
    const copy = cloneData(data);
    try {
      for (const c of d.changes) applyChangeToData(copy, c);
    } catch {
      continue;
    }
    const ev = evaluate(copy);
    evaluated++;
    const delta = ev.score.total - base.score.total;
    if (delta <= 0.01) continue;
    scored.push({
      ...d,
      scoreBefore: r1(base.score.total),
      scoreAfter: r1(ev.score.total),
      delta: Math.round(delta * 100) / 100,
      impact: {
        coverage: [base.summary.avgCoverage, ev.summary.avgCoverage],
        understaffed: [base.summary.understaffedSlots, ev.summary.understaffedSlots],
        violations: [base.summary.violationCount, ev.summary.violationCount],
        overtime: [base.summary.totalOvertime, ev.summary.totalOvertime],
        mismatches: [base.summary.mismatchCount, ev.summary.mismatchCount],
      },
    });
  }
  scored.sort((a, b) => b.delta - a.delta);
  // keep the list varied: at most 2 candidates per person and 4 per kind (the rest are near-duplicates)
  const perEmp = new Map<string, number>();
  const perKind = new Map<string, number>();
  const picked: Omit<Candidate, "id">[] = [];
  for (const c of scored) {
    if (picked.length >= limit) break;
    if ((perKind.get(c.kind) ?? 0) >= 4) continue;
    if (c.employeeIds.some((e) => (perEmp.get(e) ?? 0) >= 2)) continue;
    picked.push(c);
    perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
    c.employeeIds.forEach((e) => perEmp.set(e, (perEmp.get(e) ?? 0) + 1));
  }
  // top up with the best remaining ones if diversity rules left room
  for (const c of scored) if (picked.length < limit && !picked.includes(c)) picked.push(c);
  return { base, evaluated, candidates: picked.map((c, i) => ({ ...c, id: `C${i + 1}` })) };
}

/**
 * Greedy auto-optimization: repeatedly apply the best candidate.
 * Only candidates that reference assignments existing in the original data are allowed,
 * so the returned list of changes can be replayed later on the stored scenario.
 */
export function optimizeGreedy(data: SimData, opts: OptimizeOptions & { steps?: number } = {}) {
  const steps = opts.steps ?? 5;
  const originalAssignments = new Set(data.shifts.flatMap((s) => s.assignments.map((a) => a.id)));
  const work = cloneData(data);
  const startScore = evaluate(work).score.total;
  const chosen: Candidate[] = [];
  const touched = new Set<string>();
  for (let i = 0; i < steps; i++) {
    const { candidates } = findImprovements(work, { ...opts, limit: 30, maxEvaluations: 160 });
    const pick = candidates.find((c) =>
      c.changes.every((ch) => !("assignmentId" in ch) || originalAssignments.has(ch.assignmentId)) && c.employeeIds.every((e) => !touched.has(e)),
    );
    if (!pick) break;
    for (const ch of pick.changes) applyChangeToData(work, ch);
    pick.employeeIds.forEach((e) => touched.add(e));
    chosen.push(pick);
  }
  const end = evaluate(work);
  return { steps: chosen, changes: chosen.flatMap((c) => c.changes), startScore, endScore: end.score.total, end };
}
