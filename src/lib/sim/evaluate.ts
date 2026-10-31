import { localInfo } from "../time";
import { DEFAULT_RULES, type CoverageSlot, type Evaluation, type ScoreBreakdown, type SimData, type Violation } from "./types";

/** Default rules (kept for backwards compatibility; scenarios carry their own copy in settings.rules). */
export const RULES = DEFAULT_RULES;

const HOUR = 3_600_000;

/** Score weights: how much each family of indicators counts in the 0–100 scenario score. */
export const SCORE_WEIGHTS = { coverage: 0.45, violations: 0.25, overtime: 0.15, certifications: 0.15 };

/**
 * One number to rank scenarios and candidate changes. Each component is 0–100 (higher = better)
 * and decays smoothly, so every single improvement is visible to the optimizer.
 */
export function computeScore(s: { avgCoverage: number; violationCount: number; totalOvertime: number; mismatchCount: number; expiringCount: number }): ScoreBreakdown {
  const coverage = s.avgCoverage;
  const violations = 100 * Math.exp(-s.violationCount / 15);
  const overtime = 100 * Math.exp(-s.totalOvertime / 80);
  const certifications = 100 * Math.exp(-(s.mismatchCount + 0.5 * s.expiringCount) / 12);
  const total =
    SCORE_WEIGHTS.coverage * coverage +
    SCORE_WEIGHTS.violations * violations +
    SCORE_WEIGHTS.overtime * overtime +
    SCORE_WEIGHTS.certifications * certifications;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { total: Math.round(total * 100) / 100, coverage: r(coverage), violations: r(violations), overtime: r(overtime), certifications: r(certifications) };
}

/** Staffing need for a department at a local day/hour, including the scenario's adjustments. */
export function requiredFor(data: SimData, departmentId: string, dow: number, hour: number): number {
  let base = 0;
  for (const s of data.staffing) {
    if (s.departmentId === departmentId && s.dayOfWeek === dow && hour >= s.startHour && hour < s.endHour) {
      base = s.minStaff;
      break;
    }
  }
  if (!base) return 0;
  let factor = 1;
  for (const a of data.settings.staffingAdjustments) {
    if ((!a.departmentId || a.departmentId === departmentId) && hour >= a.startHour && hour < a.endHour) factor *= a.factor;
  }
  return factor === 1 ? base : Math.max(1, Math.ceil(base * factor - 1e-9));
}

/** Hours of a shift that fall in the night window 22:00–06:00. */
function nightHours(start: number, end: number) {
  let n = 0;
  for (let t = start; t < end; t += HOUR) {
    const h = localInfo(t).hour;
    if (h >= 22 || h < 6) n++;
  }
  return n;
}

/** Deterministic evaluation of a set of shifts. No AI involved. */
export function evaluate(data: SimData): Evaluation {
  const rules = data.settings.rules;
  const coverage: CoverageSlot[] = [];
  const shiftsByDept: Record<string, typeof data.shifts> = {};
  for (const s of data.shifts) (shiftsByDept[s.departmentId] ??= []).push(s);

  // ---- coverage per department per local hour ----
  const deptIds = Object.keys(data.departments);
  const byHourAcc: Record<string, { sum: number; n: number; min: number }> = {};
  for (let t = data.periodStart.getTime(); t < data.periodEnd.getTime(); t += HOUR) {
    const { dow, hour } = localInfo(t);
    for (const deptId of deptIds) {
      const required = requiredFor(data, deptId, dow, hour);
      if (required === 0) continue;
      const people = new Set<string>();
      for (const s of shiftsByDept[deptId] ?? []) {
        if (s.startAt.getTime() <= t && s.endAt.getTime() >= t + HOUR) for (const a of s.assignments) people.add(a.employeeId);
      }
      const assigned = people.size;
      const pct = Math.round((assigned / required) * 100);
      coverage.push({ departmentId: deptId, slotStart: new Date(t).toISOString(), slotEnd: new Date(t + HOUR).toISOString(), required, assigned, pct });
      const e = (byHourAcc[`${deptId}|${hour}`] ??= { sum: 0, n: 0, min: Infinity });
      e.sum += Math.min(pct, 100);
      e.n++;
      e.min = Math.min(e.min, pct);
    }
  }

  const coverageByDept = deptIds.map((id) => {
    const slots = coverage.filter((c) => c.departmentId === id);
    const avg = slots.length ? slots.reduce((acc, c) => acc + Math.min(c.pct, 100), 0) / slots.length : 100;
    return {
      departmentId: id,
      name: data.departments[id].name,
      avgPct: Math.round(avg * 10) / 10,
      understaffedSlots: slots.filter((c) => c.assigned < c.required).length,
      totalSlots: slots.length,
    };
  });
  const coverageByHour = Object.entries(byHourAcc).map(([k, v]) => {
    const [departmentId, hour] = k.split("|");
    return { departmentId, hour: Number(hour), avgPct: Math.round(v.sum / v.n), minPct: v.min };
  });

  // ---- per employee: hours, rest, overlap, fairness ----
  const violations: Violation[] = [];
  const absent = new Set(data.settings.absences.map((a) => `${a.employeeId}|${a.date}`));
  const empShifts: Record<string, { shiftId: string; start: number; end: number }[]> = {};
  for (const s of data.shifts) {
    for (const a of s.assignments) (empShifts[a.employeeId] ??= []).push({ shiftId: s.id, start: s.startAt.getTime(), end: s.endAt.getTime() });
  }
  const hours: Evaluation["hours"] = [];
  const perEmployee: Evaluation["fairness"]["perEmployee"] = [];
  for (const [empId, list] of Object.entries(empShifts)) {
    const emp = data.employees[empId];
    const name = emp?.name ?? empId;
    list.sort((a, b) => a.start - b.start);
    let total = 0;
    let nights = 0;
    let weekends = 0;
    const weekly: Record<string, number> = {};
    for (let i = 0; i < list.length; i++) {
      const sh = list[i];
      const h = (sh.end - sh.start) / HOUR;
      const info = localInfo(sh.start);
      total += h;
      weekly[info.monday] = (weekly[info.monday] ?? 0) + h;
      if (nightHours(sh.start, sh.end) >= 3) nights++;
      if (info.dow >= 6) weekends++;
      if (absent.has(`${empId}|${info.date}`)) {
        violations.push({ type: "ABSENT_ASSIGNED", employeeId: empId, shiftId: sh.shiftId, message: `${name}: programat(ă) pe ${info.date}, dar e absent(ă)` });
      }
      if (i > 0) {
        const gap = (sh.start - list[i - 1].end) / HOUR;
        if (gap < 0) {
          violations.push({ type: "OVERLAP", employeeId: empId, shiftId: sh.shiftId, message: `${name}: două ture suprapuse` });
        } else if (gap < rules.minRestHours) {
          violations.push({
            type: "REST_TOO_SHORT",
            employeeId: empId,
            shiftId: sh.shiftId,
            message: `${name}: doar ${Math.round(gap * 10) / 10}h repaus între ture (minim ${rules.minRestHours}h)`,
          });
        }
      }
    }
    let overtime = 0;
    for (const [wk, h] of Object.entries(weekly)) {
      overtime += Math.max(0, h - rules.normalWeeklyHours);
      if (h > rules.maxWeeklyHours) {
        violations.push({ type: "WEEKLY_HOURS", employeeId: empId, message: `${name}: ${Math.round(h)}h în săptămâna ${wk} (maxim ${rules.maxWeeklyHours}h)` });
      }
    }
    hours.push({ employeeId: empId, name, total: Math.round(total * 10) / 10, overtime: Math.round(overtime * 10) / 10 });
    if (emp) perEmployee.push({ employeeId: empId, name, departmentId: emp.departmentId, hours: Math.round(total), nights, weekends });
  }
  hours.sort((a, b) => b.total - a.total);

  // ---- skills on positions, leads ----
  const skillMismatches: Evaluation["skillMismatches"] = [];
  for (const s of data.shifts) {
    let hasLead = false;
    for (const a of s.assignments) {
      const emp = data.employees[a.employeeId];
      if (!emp) continue;
      if (emp.levelRank >= rules.leadMinRank) hasLead = true;
      if (!a.positionId) continue;
      const pos = data.positions[a.positionId];
      if (!pos) continue;
      const missing: string[] = [];
      let missingCert = false;
      for (const req of pos.skills) {
        const have = emp.skills[req.skillId];
        const expired = have?.expiresAt && have.expiresAt.getTime() < s.startAt.getTime();
        if (!have || have.proficiency < req.minProficiency || expired) {
          const sk = data.skills[req.skillId];
          missing.push(`${sk?.name ?? req.skillId}${expired ? " (expirat)" : have ? ` (nivel ${have.proficiency}/${req.minProficiency})` : ""}`);
          if (sk?.type === "CERTIFICATION") missingCert = true;
        }
      }
      if (missing.length) {
        skillMismatches.push({ employeeId: emp.id, name: emp.name, positionId: pos.id, positionName: pos.name, shiftId: s.id, missingSkills: missing });
        if (missingCert) {
          violations.push({
            type: "MISSING_CERT",
            employeeId: emp.id,
            shiftId: s.id,
            message: `${emp.name} pe postul „${pos.name}” fără certificare validă: ${missing.join(", ")}`,
          });
        }
      }
    }
    if (!hasLead && s.assignments.length > 0) {
      const lvl = Object.values(data.levels).find((l) => l.rank === rules.leadMinRank)?.name ?? "Senior";
      violations.push({
        type: "NO_LEAD",
        shiftId: s.id,
        departmentId: s.departmentId,
        message: `${data.departments[s.departmentId]?.name ?? ""}: tură fără lider (nivel ≥ ${lvl})`,
      });
    }
  }

  // ---- certifications expiring in the period (for people working in it) ----
  const expiringCertifications: Evaluation["expiringCertifications"] = [];
  for (const empId of Object.keys(empShifts)) {
    const emp = data.employees[empId];
    if (!emp) continue;
    for (const [skillId, sk] of Object.entries(emp.skills)) {
      if (!sk.expiresAt) continue;
      if (sk.expiresAt.getTime() <= data.periodEnd.getTime()) {
        expiringCertifications.push({
          employeeId: empId,
          name: emp.name,
          skillId,
          skillName: data.skills[skillId]?.name ?? skillId,
          expiresAt: sk.expiresAt.toISOString(),
          expired: sk.expiresAt.getTime() < data.periodStart.getTime(),
        });
      }
    }
  }
  expiringCertifications.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

  // ---- fairness by department ----
  const byDept = deptIds
    .map((id) => {
      const list = perEmployee.filter((p) => p.departmentId === id);
      if (!list.length) return null;
      const avg = (k: "nights" | "weekends") => Math.round((list.reduce((a, p) => a + p[k], 0) / list.length) * 10) / 10;
      const hrs = list.map((p) => p.hours);
      return {
        departmentId: id,
        name: data.departments[id].name,
        people: list.length,
        avgNights: avg("nights"),
        maxNights: Math.max(...list.map((p) => p.nights)),
        avgWeekends: avg("weekends"),
        maxWeekends: Math.max(...list.map((p) => p.weekends)),
        hoursSpread: Math.max(...hrs) - Math.min(...hrs),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  let capSum = 0;
  let under = 0;
  for (const c of coverage) {
    capSum += Math.min(c.pct, 100);
    if (c.assigned < c.required) under++;
  }
  const base = {
    avgCoverage: coverage.length ? Math.round((capSum / coverage.length) * 10) / 10 : 100,
    understaffedSlots: under,
    totalHours: Math.round(hours.reduce((a, h) => a + h.total, 0)),
    totalOvertime: Math.round(hours.reduce((a, h) => a + h.overtime, 0) * 10) / 10,
    violationCount: violations.length,
    mismatchCount: skillMismatches.length,
    expiringCount: expiringCertifications.length,
    shiftCount: data.shifts.length,
  };
  // the score uses the unrounded coverage so tiny improvements still count
  const score = computeScore({ ...base, avgCoverage: coverage.length ? capSum / coverage.length : 100 });
  const summary = { score: Math.round(score.total * 10) / 10, ...base };

  return {
    coverage,
    coverageByDept,
    coverageByHour,
    hours,
    violations,
    skillMismatches,
    expiringCertifications,
    fairness: { perEmployee: perEmployee.sort((a, b) => b.nights - a.nights || b.weekends - a.weekends), byDept },
    score,
    summary,
  };
}

export type Comparison = {
  summary: Record<keyof Evaluation["summary"], { a: number; b: number; delta: number }>;
  byDept: { departmentId: string; name: string; a: number; b: number; delta: number }[];
};

/** Difference b - a for every indicator. */
export function compare(a: Evaluation, b: Evaluation): Comparison {
  const summary = {} as Comparison["summary"];
  for (const k of Object.keys(a.summary) as (keyof Evaluation["summary"])[]) {
    summary[k] = { a: a.summary[k], b: b.summary[k], delta: Math.round((b.summary[k] - a.summary[k]) * 10) / 10 };
  }
  const byDept = a.coverageByDept.map((d) => {
    const other = b.coverageByDept.find((x) => x.departmentId === d.departmentId);
    const bv = other?.avgPct ?? 0;
    return { departmentId: d.departmentId, name: d.name, a: d.avgPct, b: bv, delta: Math.round((bv - d.avgPct) * 10) / 10 };
  });
  return { summary, byDept };
}
