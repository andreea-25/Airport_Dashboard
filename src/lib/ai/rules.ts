import { prisma } from "../db";
import { evaluate } from "../sim/evaluate";
import { applyChangeToData, cloneData } from "../sim/changes";
import { loadScenarioData, previewChanges } from "../sim/scenario";
import { localDateStr, localHour, localTimeStr } from "../time";
import type { Change, SimData } from "../sim/types";

/**
 * Deterministic fallback when Ollama is not available: a few heuristic suggestions,
 * each verified by the simulation engine before it is saved. Source = "RULES".
 */
export async function ruleBasedSuggestions(scenarioId: string, max = 3) {
  const data = await loadScenarioData(scenarioId);
  const base = evaluate(data);
  const candidates: { changes: Change[]; rationale: string }[] = [];

  // 1) Early-morning wave: departments short at 05:00 whose shifts start at 06:00 -> shift the morning team to 05:00–13:00
  const shortAt5 = new Set(base.coverage.filter((c) => localHour(new Date(c.slotStart)) === 5 && c.assigned < c.required).map((c) => c.departmentId));
  for (const deptId of shortAt5) {
    const morning = data.shifts.find((s) => s.departmentId === deptId && localTimeStr(s.startAt) === "06:00");
    if (morning) {
      // keep the shift length, just start one hour earlier
      const end = localTimeStr(new Date(morning.endAt.getTime() - 3.6e6));
      candidates.push({
        changes: [{ type: "CHANGE_SHIFT_HOURS", departmentId: deptId, fromStart: "06:00", startTime: "05:00", endTime: end }],
        rationale: `${data.departments[deptId].name}: valul de dimineață începe la 05:00, dar tura începe la 06:00. O tură decalată 05:00–${end} acoperă primul val.`,
      });
    }
  }

  // 2) Shifts without a lead: move a Senior+ from a team that has two of them
  const noLead = base.violations.filter((v) => v.type === "NO_LEAD" && v.shiftId);
  const teamsNoLead = new Set(noLead.map((v) => data.shifts.find((s) => s.id === v.shiftId)?.teamId).filter(Boolean) as string[]);
  for (const teamId of teamsNoLead) {
    const deptId = data.teams[teamId].departmentId;
    const donorTeams = Object.values(data.teams).filter((t) => t.departmentId === deptId && t.id !== teamId);
    for (const t of donorTeams) {
      const seniors = Object.values(data.employees).filter((e) => e.teamId === t.id && e.levelRank >= 3);
      if (seniors.length >= 2) {
        const pick = seniors.sort((a, b) => a.levelRank - b.levelRank)[0];
        candidates.push({
          changes: [{ type: "MOVE_EMPLOYEE_TEAM", employeeId: pick.id, teamId }],
          rationale: `${data.teams[teamId].name} (${data.departments[deptId].name}) nu are lider de nivel Senior. ${pick.name} (${pick.levelName}) din ${t.name} poate prelua rolul; ${t.name} rămâne cu un lider.`,
        });
        break;
      }
    }
  }

  // 3) Understaffed shifts: add a qualified colleague from the same department who is free that day
  const under = base.coverage.filter((c) => c.assigned < c.required);
  const tried = new Set<string>();
  for (const slot of under) {
    const shift = data.shifts.find((s) => s.departmentId === slot.departmentId && s.startAt.toISOString() <= slot.slotStart && s.endAt.toISOString() >= slot.slotEnd);
    if (!shift || tried.has(shift.id)) continue;
    tried.add(shift.id);
    const day = localDateStr(shift.startAt);
    const busy = new Set(data.shifts.filter((s) => Math.abs(s.startAt.getTime() - shift.startAt.getTime()) < 36 * 3.6e6).flatMap((s) => s.assignments.map((a) => a.employeeId)));
    const free = Object.values(data.employees).filter((e) => e.departmentId === slot.departmentId && !busy.has(e.id));
    const emp = free.sort((a, b) => b.levelRank - a.levelRank)[0];
    if (!emp) continue;
    candidates.push({
      changes: [{ type: "ADD_ASSIGNMENT", shiftId: shift.id, employeeId: emp.id }],
      rationale: `${data.departments[slot.departmentId].name}, ${day} ${localTimeStr(shift.startAt)}–${localTimeStr(shift.endAt)}: ${shift.assignments.length}/${slot.required} oameni. ${emp.name} e liber în acea zi și are repausul respectat.`,
    });
    if (tried.size >= 6) break;
  }

  // keep only candidates the engine confirms as improvements
  const saved = [];
  for (const c of candidates) {
    if (saved.length >= max) break;
    try {
      const copy: SimData = cloneData(data);
      for (const ch of c.changes) applyChangeToData(copy, ch);
      const after = evaluate(copy);
      const better = after.summary.avgCoverage > base.summary.avgCoverage || after.summary.violationCount < base.summary.violationCount;
      const worse = after.summary.violationCount > base.summary.violationCount || after.summary.avgCoverage < base.summary.avgCoverage;
      if (!better || worse) continue;
      const r = await previewChanges(scenarioId, c.changes);
      saved.push(
        await prisma.scenarioSuggestion.create({
          data: { scenarioId, source: "RULES", changes: c.changes as object, rationale: c.rationale, estimatedImpact: { messages: r.messages, ...r.impact } as object },
        }),
      );
    } catch {
      /* skip invalid candidate */
    }
  }
  return saved;
}
