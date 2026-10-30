import { localDateStr, localTimeStr, shiftInterval } from "../time";
import type { Change, SimData, SimShift } from "./types";

export class SimError extends Error {}

function newId() {
  return `sim_${globalThis.crypto.randomUUID()}`;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Apply a change to the in-memory data (mutates it). Throws SimError if the change is invalid. */
export function applyChangeToData(data: SimData, change: Change): string {
  switch (change.type) {
    case "MOVE_EMPLOYEE_TEAM": {
      const emp = data.employees[change.employeeId];
      const team = data.teams[change.teamId];
      if (!emp) throw new SimError("Angajat inexistent");
      if (!team) throw new SimError("Echipă inexistentă");
      if (emp.teamId === team.id) throw new SimError("Angajatul este deja în această echipă");
      const oldTeam = emp.teamId;
      // the employee follows the new team's schedule: for each day they worked with the old team,
      // they are moved onto the new team's shift of that day (if any)
      const shiftsByTeamDay: Record<string, SimShift> = {};
      for (const s of data.shifts) if (s.teamId === team.id) shiftsByTeamDay[localDateStr(s.startAt)] = s;
      let moved = 0;
      for (const s of data.shifts) {
        if (s.teamId !== oldTeam) continue;
        const idx = s.assignments.findIndex((a) => a.employeeId === emp.id);
        if (idx < 0) continue;
        const [a] = s.assignments.splice(idx, 1);
        const target = shiftsByTeamDay[localDateStr(s.startAt)];
        if (target && !target.assignments.some((x) => x.employeeId === emp.id)) {
          const pos = Object.values(data.positions).find((p) => p.departmentId === team.departmentId);
          target.assignments.push({
            ...a,
            id: newId(),
            positionId: team.departmentId === s.departmentId ? a.positionId : pos?.id ?? null,
            isLead: false,
          });
          moved++;
        }
      }
      emp.teamId = team.id;
      emp.departmentId = team.departmentId;
      data.overrides[emp.id] = { ...(data.overrides[emp.id] ?? {}), teamId: team.id, departmentId: team.departmentId };
      return `${emp.name} mutat în ${data.departments[team.departmentId]?.name} / ${team.name} (${moved} ture)`;
    }

    case "SWAP_TEAMS": {
      const a = data.teams[change.teamAId];
      const b = data.teams[change.teamBId];
      if (!a || !b) throw new SimError("Echipă inexistentă");
      if (a.departmentId !== b.departmentId) throw new SimError("Echipele trebuie să fie din același departament");
      // swap the working hours of the two teams day by day
      const byDay = (teamId: string) => {
        const m: Record<string, SimShift> = {};
        for (const s of data.shifts) if (s.teamId === teamId) m[localDateStr(s.startAt)] = s;
        return m;
      };
      const da = byDay(a.id);
      const db = byDay(b.id);
      let swapped = 0;
      for (const day of Object.keys(da)) {
        const sa = da[day];
        const sb = db[day];
        if (!sb) continue;
        [sa.startAt, sb.startAt] = [sb.startAt, sa.startAt];
        [sa.endAt, sb.endAt] = [sb.endAt, sa.endAt];
        swapped++;
      }
      if (!swapped) throw new SimError("Echipele nu au ture în aceleași zile");
      return `${a.name} și ${b.name} și-au schimbat programul (${swapped} zile)`;
    }

    case "MOVE_ASSIGNMENT": {
      const from = data.shifts.find((s) => s.assignments.some((a) => a.id === change.assignmentId));
      const to = data.shifts.find((s) => s.id === change.toShiftId);
      if (!from) throw new SimError("Asignare inexistentă");
      if (!to) throw new SimError("Tură inexistentă");
      const idx = from.assignments.findIndex((a) => a.id === change.assignmentId);
      const [a] = from.assignments.splice(idx, 1);
      if (to.assignments.some((x) => x.employeeId === a.employeeId)) throw new SimError("Angajatul este deja în tura țintă");
      if (to.departmentId !== from.departmentId) {
        a.positionId = Object.values(data.positions).find((p) => p.departmentId === to.departmentId)?.id ?? null;
        a.isLead = false;
      }
      to.assignments.push(a);
      return `${data.employees[a.employeeId]?.name} mutat în tura din ${localDateStr(to.startAt)} ${localTimeStr(to.startAt)}`;
    }

    case "ADD_ASSIGNMENT": {
      const s = data.shifts.find((x) => x.id === change.shiftId);
      const emp = data.employees[change.employeeId];
      if (!s) throw new SimError("Tură inexistentă");
      if (!emp) throw new SimError("Angajat inexistent");
      if (s.assignments.some((a) => a.employeeId === emp.id)) throw new SimError("Angajatul este deja în tură");
      if (change.positionId && data.positions[change.positionId]?.departmentId !== s.departmentId) {
        throw new SimError("Postul nu aparține departamentului turei");
      }
      const positionId = change.positionId ?? Object.values(data.positions).find((p) => p.departmentId === s.departmentId)?.id ?? null;
      s.assignments.push({ id: newId(), employeeId: emp.id, positionId, isLead: !!change.isLead });
      return `${emp.name} adăugat în tura din ${localDateStr(s.startAt)} ${localTimeStr(s.startAt)}`;
    }

    case "REMOVE_ASSIGNMENT": {
      const s = data.shifts.find((x) => x.assignments.some((a) => a.id === change.assignmentId));
      if (!s) throw new SimError("Asignare inexistentă");
      const idx = s.assignments.findIndex((a) => a.id === change.assignmentId);
      const [a] = s.assignments.splice(idx, 1);
      return `${data.employees[a.employeeId]?.name} scos din tura din ${localDateStr(s.startAt)}`;
    }

    case "CHANGE_SHIFT_HOURS": {
      if (!TIME_RE.test(change.startTime) || !TIME_RE.test(change.endTime)) throw new SimError("Ore invalide (format HH:mm)");
      if (change.startTime === change.endTime) throw new SimError("Ora de început și de sfârșit nu pot fi egale");
      let n = 0;
      for (const s of data.shifts) {
        if (change.shiftId && s.id !== change.shiftId) continue;
        if (s.departmentId !== change.departmentId) continue;
        if (change.teamId && s.teamId !== change.teamId) continue;
        if (change.fromStart && localTimeStr(s.startAt) !== change.fromStart) continue;
        const { startAt, endAt } = shiftInterval(localDateStr(s.startAt), change.startTime, change.endTime);
        s.startAt = startAt;
        s.endAt = endAt;
        n++;
      }
      if (!n) throw new SimError("Nicio tură nu corespunde filtrului");
      return `${n} ture din ${data.departments[change.departmentId]?.name} trec pe ${change.startTime}–${change.endTime}`;
    }

    case "SET_EMPLOYEE_LEVEL": {
      const emp = data.employees[change.employeeId];
      const lvl = data.levels[change.levelId];
      if (!emp || !lvl) throw new SimError("Angajat sau nivel inexistent");
      emp.levelId = lvl.id;
      emp.levelRank = lvl.rank;
      emp.levelName = lvl.name;
      data.overrides[emp.id] = { ...(data.overrides[emp.id] ?? {}), levelId: lvl.id };
      return `${emp.name} promovat (în simulare) la ${lvl.name}`;
    }

    default:
      throw new SimError("Tip de modificare necunoscut");
  }
}

/** Deep clone (Dates preserved) so previews never touch the stored scenario. */
export function cloneData(data: SimData): SimData {
  return {
    ...data,
    shifts: data.shifts.map((s) => ({ ...s, startAt: new Date(s.startAt), endAt: new Date(s.endAt), assignments: s.assignments.map((a) => ({ ...a })) })),
    employees: Object.fromEntries(Object.entries(data.employees).map(([k, e]) => [k, { ...e, skills: { ...e.skills } }])),
    overrides: Object.fromEntries(Object.entries(data.overrides).map(([k, o]) => [k, { ...o }])),
  };
}
