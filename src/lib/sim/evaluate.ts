import { hoursBetween, localHour, localIsoDow, mondayOf } from "../time";
import type { CoverageSlot, Evaluation, SimData, Violation } from "./types";

export const RULES = {
  minRestHours: 12,
  maxWeeklyHours: 48,
  normalWeeklyHours: 40,
  leadMinRank: 3, // Senior
};

const HOUR = 3_600_000;

function requiredFor(data: SimData, departmentId: string, dow: number, hour: number): number {
  for (const s of data.staffing) {
    if (s.departmentId === departmentId && s.dayOfWeek === dow && hour >= s.startHour && hour < s.endHour) return s.minStaff;
  }
  return 0;
}

/** Deterministic evaluation of a set of shifts. No AI involved. */
export function evaluate(data: SimData): Evaluation {
  const coverage: CoverageSlot[] = [];
  const shiftsByDept: Record<string, typeof data.shifts> = {};
  for (const s of data.shifts) (shiftsByDept[s.departmentId] ??= []).push(s);

  // ---- coverage per department per local hour ----
  const deptIds = Object.keys(data.departments);
  for (let t = data.periodStart.getTime(); t < data.periodEnd.getTime(); t += HOUR) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + HOUR);
    const dow = localIsoDow(slotStart);
    const hour = localHour(slotStart);
    for (const deptId of deptIds) {
      const required = requiredFor(data, deptId, dow, hour);
      if (required === 0) continue;
      const people = new Set<string>();
      for (const s of shiftsByDept[deptId] ?? []) {
        if (s.startAt.getTime() <= t && s.endAt.getTime() >= t + HOUR) for (const a of s.assignments) people.add(a.employeeId);
      }
      const assigned = people.size;
      coverage.push({
        departmentId: deptId,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        required,
        assigned,
        pct: Math.round((assigned / required) * 100),
      });
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

  const byHour: Record<string, { sum: number; n: number; min: number }> = {};
  for (const c of coverage) {
    const key = `${c.departmentId}|${localHour(new Date(c.slotStart))}`;
    const e = (byHour[key] ??= { sum: 0, n: 0, min: Infinity });
    e.sum += Math.min(c.pct, 100);
    e.n++;
    e.min = Math.min(e.min, c.pct);
  }
  const coverageByHour = Object.entries(byHour).map(([k, v]) => {
    const [departmentId, hour] = k.split("|");
    return { departmentId, hour: Number(hour), avgPct: Math.round(v.sum / v.n), minPct: v.min };
  });

  // ---- per employee: hours, rest, overlap ----
  const violations: Violation[] = [];
  const empShifts: Record<string, { shiftId: string; startAt: Date; endAt: Date }[]> = {};
  for (const s of data.shifts) {
    for (const a of s.assignments) (empShifts[a.employeeId] ??= []).push({ shiftId: s.id, startAt: s.startAt, endAt: s.endAt });
  }
  const hours: Evaluation["hours"] = [];
  for (const [empId, list] of Object.entries(empShifts)) {
    const emp = data.employees[empId];
    const name = emp?.name ?? empId;
    list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    let total = 0;
    const weekly: Record<string, number> = {};
    for (let i = 0; i < list.length; i++) {
      const h = hoursBetween(list[i].startAt, list[i].endAt);
      total += h;
      const wk = mondayOf(list[i].startAt);
      weekly[wk] = (weekly[wk] ?? 0) + h;
      if (i > 0) {
        const gap = hoursBetween(list[i - 1].endAt, list[i].startAt);
        if (gap < 0) {
          violations.push({ type: "OVERLAP", employeeId: empId, shiftId: list[i].shiftId, message: `${name}: două ture suprapuse` });
        } else if (gap < RULES.minRestHours) {
          violations.push({
            type: "REST_TOO_SHORT",
            employeeId: empId,
            shiftId: list[i].shiftId,
            message: `${name}: doar ${Math.round(gap * 10) / 10}h repaus între ture (minim ${RULES.minRestHours}h)`,
          });
        }
      }
    }
    let overtime = 0;
    for (const [wk, h] of Object.entries(weekly)) {
      overtime += Math.max(0, h - RULES.normalWeeklyHours);
      if (h > RULES.maxWeeklyHours) {
        violations.push({ type: "WEEKLY_HOURS", employeeId: empId, message: `${name}: ${Math.round(h)}h în săptămâna ${wk} (maxim ${RULES.maxWeeklyHours}h)` });
      }
    }
    hours.push({ employeeId: empId, name, total: Math.round(total * 10) / 10, overtime: Math.round(overtime * 10) / 10 });
  }
  hours.sort((a, b) => b.total - a.total);

  // ---- skills on positions, leads ----
  const skillMismatches: Evaluation["skillMismatches"] = [];
  for (const s of data.shifts) {
    let hasLead = false;
    for (const a of s.assignments) {
      const emp = data.employees[a.employeeId];
      if (!emp) continue;
      if (emp.levelRank >= RULES.leadMinRank) hasLead = true;
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
      violations.push({
        type: "NO_LEAD",
        shiftId: s.id,
        departmentId: s.departmentId,
        message: `${data.departments[s.departmentId]?.name ?? ""}: tură fără lider (nivel ≥ Senior)`,
      });
    }
  }

  // ---- certifications expiring in the period (for people working in it) ----
  const expiringCertifications: Evaluation["expiringCertifications"] = [];
  const working = new Set(Object.keys(empShifts));
  for (const empId of working) {
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

  const capped = coverage.map((c) => Math.min(c.pct, 100));
  const summary = {
    avgCoverage: capped.length ? Math.round((capped.reduce((a, b) => a + b, 0) / capped.length) * 10) / 10 : 100,
    understaffedSlots: coverage.filter((c) => c.assigned < c.required).length,
    totalHours: Math.round(hours.reduce((a, h) => a + h.total, 0)),
    totalOvertime: Math.round(hours.reduce((a, h) => a + h.overtime, 0) * 10) / 10,
    violationCount: violations.length,
    mismatchCount: skillMismatches.length,
    expiringCount: expiringCertifications.length,
    shiftCount: data.shifts.length,
  };

  return { coverage, coverageByDept, coverageByHour, hours, violations, skillMismatches, expiringCertifications, summary };
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
