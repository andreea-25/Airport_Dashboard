import { localInfo } from "../time";
import type { Evaluation, SimData } from "./types";

export type CalAssignment = {
  id: string;
  employeeId: string;
  name: string;
  level: string;
  rank: number;
  isLead: boolean;
  position: string | null;
  warnings: string[];
};
export type CalShift = {
  id: string;
  departmentId: string;
  teamId: string | null;
  date: string;
  start: string;
  end: string;
  required: number;
  minPct: number;
  deficit: number;
  surplus: number;
  assignments: CalAssignment[];
};
export type CalEmployee = { id: string; name: string; departmentId: string; teamId: string | null; level: string; rank: number; hours: number; absent: string[] };
export type CalendarData = { days: string[]; shifts: CalShift[]; employees: CalEmployee[] };

const HOUR = 3_600_000;
const short = (msg: string) => msg.replace(/^[^:]+:\s*/, "");

/** Everything the drag & drop calendar needs, precomputed on the server from the engine's evaluation. */
export function buildCalendar(data: SimData, ev: Evaluation): CalendarData {
  const days: string[] = [];
  for (let t = data.periodStart.getTime(); t < data.periodEnd.getTime(); t += 24 * HOUR) {
    const d = localInfo(t + 12 * HOUR).date; // noon avoids DST edge cases
    if (!days.includes(d)) days.push(d);
  }
  const slot = new Map<string, { required: number; assigned: number; pct: number }>();
  for (const c of ev.coverage) slot.set(`${c.departmentId}|${new Date(c.slotStart).getTime()}`, c);
  const warn = new Map<string, string[]>();
  const add = (k: string, m: string) => warn.set(k, [...(warn.get(k) ?? []), m]);
  for (const v of ev.violations) if (v.employeeId && v.shiftId) add(`${v.shiftId}|${v.employeeId}`, short(v.message));
  for (const m of ev.skillMismatches) add(`${m.shiftId}|${m.employeeId}`, `fără ${m.missingSkills.join(", ")}`);
  const absences = data.settings.absences;

  const shifts: CalShift[] = data.shifts.map((s) => {
    let required = 0;
    let minPct = Infinity;
    let deficit = 0;
    let surplus = Infinity;
    for (let t = s.startAt.getTime(); t < s.endAt.getTime(); t += HOUR) {
      const c = slot.get(`${s.departmentId}|${t}`);
      if (!c) continue;
      required = Math.max(required, c.required);
      minPct = Math.min(minPct, c.pct);
      deficit = Math.max(deficit, c.required - c.assigned);
      surplus = Math.min(surplus, c.assigned - c.required);
    }
    return {
      id: s.id,
      departmentId: s.departmentId,
      teamId: s.teamId,
      date: localInfo(s.startAt).date,
      start: localInfo(s.startAt).time,
      end: localInfo(s.endAt).time,
      required,
      minPct: minPct === Infinity ? 100 : minPct,
      deficit,
      surplus: surplus === Infinity ? 0 : Math.max(0, surplus),
      assignments: s.assignments
        .map((a) => {
          const e = data.employees[a.employeeId];
          return {
            id: a.id,
            employeeId: a.employeeId,
            name: e?.name ?? a.employeeId,
            level: e?.levelName ?? "",
            rank: e?.levelRank ?? 0,
            isLead: a.isLead,
            position: a.positionId ? data.positions[a.positionId]?.name ?? null : null,
            warnings: warn.get(`${s.id}|${a.employeeId}`) ?? [],
          };
        })
        .sort((x, y) => Number(y.isLead) - Number(x.isLead) || y.rank - x.rank),
    };
  });
  const hours = new Map(ev.hours.map((h) => [h.employeeId, h.total]));
  const employees: CalEmployee[] = Object.values(data.employees)
    .map((e) => ({
      id: e.id,
      name: e.name,
      departmentId: e.departmentId,
      teamId: e.teamId,
      level: e.levelName,
      rank: e.levelRank,
      hours: hours.get(e.id) ?? 0,
      absent: absences.filter((a) => a.employeeId === e.id).map((a) => a.date),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  return { days, shifts, employees };
}
