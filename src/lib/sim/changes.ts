import { addDaysStr, localDateStr, localInfo, localTimeStr, shiftInterval } from "../time";
import type { Change, SimData, SimEmployee, SimShift } from "./types";

export class SimError extends Error {}

function newId() {
  return `sim_${globalThis.crypto.randomUUID()}`;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is the employee qualified (valid skills) for a position at a given time? */
export function qualifiesFor(data: SimData, emp: SimEmployee, positionId: string, at: Date): boolean {
  const pos = data.positions[positionId];
  if (!pos) return false;
  return pos.skills.every((r) => {
    const h = emp.skills[r.skillId];
    return !!h && h.proficiency >= r.minProficiency && !(h.expiresAt && h.expiresAt.getTime() < at.getTime());
  });
}

/** A position in the department the employee is qualified for (falls back to the first position). */
export function bestPosition(data: SimData, emp: SimEmployee, departmentId: string, at: Date): string | null {
  const list = Object.values(data.positions).filter((p) => p.departmentId === departmentId);
  return (list.find((p) => qualifiesFor(data, emp, p.id, at)) ?? list[0])?.id ?? null;
}

export function isAbsent(data: SimData, employeeId: string, date: string) {
  return data.settings.absences.some((a) => a.employeeId === employeeId && a.date === date);
}

/** Apply settings that change employee data in memory (expired skills). Call after loading a scenario. */
export function applySettingsToData(data: SimData) {
  const expiredAt = new Date(data.periodStart.getTime() - 86_400_000);
  for (const ex of data.settings.expiredSkills) {
    for (const e of Object.values(data.employees)) {
      if (ex.departmentId && e.departmentId !== ex.departmentId) continue;
      const sk = e.skills[ex.skillId];
      if (sk && (!sk.expiresAt || sk.expiresAt.getTime() > expiredAt.getTime())) e.skills[ex.skillId] = { ...sk, expiresAt: expiredAt };
    }
  }
}

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
      if (to.assignments.some((x) => x.employeeId === a.employeeId)) {
        from.assignments.splice(idx, 0, a);
        throw new SimError("Angajatul este deja în tura țintă");
      }
      if (isAbsent(data, a.employeeId, localInfo(to.startAt).date)) {
        from.assignments.splice(idx, 0, a);
        throw new SimError(`${data.employees[a.employeeId]?.name} este absent(ă) în acea zi`);
      }
      if (to.departmentId !== from.departmentId) {
        const emp = data.employees[a.employeeId];
        a.positionId = emp ? bestPosition(data, emp, to.departmentId, to.startAt) : null;
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
      if (isAbsent(data, emp.id, localInfo(s.startAt).date)) throw new SimError(`${emp.name} este absent(ă) în acea zi`);
      if (change.positionId && data.positions[change.positionId]?.departmentId !== s.departmentId) {
        throw new SimError("Postul nu aparține departamentului turei");
      }
      const positionId = change.positionId ?? bestPosition(data, emp, s.departmentId, s.startAt);
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

    case "SET_ASSIGNMENT": {
      const s = data.shifts.find((x) => x.assignments.some((a) => a.id === change.assignmentId));
      if (!s) throw new SimError("Asignare inexistentă");
      const a = s.assignments.find((x) => x.id === change.assignmentId)!;
      if (change.positionId !== undefined) {
        if (change.positionId && data.positions[change.positionId]?.departmentId !== s.departmentId) throw new SimError("Postul nu aparține departamentului turei");
        a.positionId = change.positionId;
      }
      if (change.isLead !== undefined) a.isLead = change.isLead;
      const pos = a.positionId ? data.positions[a.positionId]?.name : "—";
      return `${data.employees[a.employeeId]?.name}: post ${pos}${a.isLead ? ", lider" : ""}`;
    }

    case "SET_RULES": {
      const r = { ...data.settings.rules, ...change.rules };
      if (r.minRestHours < 0 || r.minRestHours > 24) throw new SimError("Repausul minim trebuie să fie între 0 și 24h");
      if (r.maxWeeklyHours < 8 || r.maxWeeklyHours > 84) throw new SimError("Maximul săptămânal trebuie să fie între 8 și 84h");
      if (r.normalWeeklyHours < 8 || r.normalWeeklyHours > r.maxWeeklyHours) throw new SimError("Norma săptămânală trebuie să fie între 8h și maximul săptămânal");
      if (r.leadMinRank < 1 || r.leadMinRank > 5) throw new SimError("Nivel de lider invalid");
      data.settings.rules = r;
      return `Reguli: repaus ${r.minRestHours}h, maxim ${r.maxWeeklyHours}h/săpt., normă ${r.normalWeeklyHours}h, lider de la nivelul ${Object.values(data.levels).find((l) => l.rank === r.leadMinRank)?.name ?? r.leadMinRank}`;
    }

    case "ADJUST_STAFFING": {
      if (change.startHour < 0 || change.endHour > 24 || change.startHour >= change.endHour) throw new SimError("Interval orar invalid");
      if (change.factor <= 0 || change.factor > 5) throw new SimError("Factor invalid (0–5)");
      if (change.departmentId && !data.departments[change.departmentId]) throw new SimError("Departament inexistent");
      const where = change.departmentId ? data.departments[change.departmentId].name : "toate departamentele";
      const pct = Math.round((change.factor - 1) * 100);
      const label = change.label || `${pct >= 0 ? "+" : ""}${pct}% necesar ${String(change.startHour).padStart(2, "0")}:00–${String(change.endHour).padStart(2, "0")}:00, ${where}`;
      data.settings.staffingAdjustments.push({ id: newId(), departmentId: change.departmentId ?? null, startHour: change.startHour, endHour: change.endHour, factor: change.factor, label });
      return label;
    }

    case "REMOVE_STAFFING_ADJUSTMENT": {
      const i = data.settings.staffingAdjustments.findIndex((a) => a.id === change.id);
      if (i < 0) throw new SimError("Ajustare inexistentă");
      const [a] = data.settings.staffingAdjustments.splice(i, 1);
      return `Eliminat: ${a.label}`;
    }

    case "ADD_ABSENCE": {
      const emp = data.employees[change.employeeId];
      if (!emp) throw new SimError("Angajat inexistent");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date)) throw new SimError("Dată invalidă");
      const days = Math.max(1, Math.min(31, change.days ?? 1));
      const dates = Array.from({ length: days }, (_, i) => addDaysStr(change.date, i));
      let removed = 0;
      for (const s of data.shifts) {
        if (!dates.includes(localInfo(s.startAt).date)) continue;
        const before = s.assignments.length;
        s.assignments = s.assignments.filter((a) => a.employeeId !== emp.id);
        removed += before - s.assignments.length;
      }
      for (const d of dates) if (!isAbsent(data, emp.id, d)) data.settings.absences.push({ employeeId: emp.id, date: d, reason: change.reason ?? "Concediu medical" });
      return `${emp.name}: ${change.reason ?? "concediu medical"} ${days > 1 ? `${change.date} (+${days - 1} zile)` : change.date} — scos(ă) din ${removed} ture`;
    }

    case "EXPIRE_SKILL": {
      const sk = data.skills[change.skillId];
      if (!sk) throw new SimError("Skill inexistent");
      data.settings.expiredSkills.push({ skillId: change.skillId, departmentId: change.departmentId ?? null });
      applySettingsToData(data);
      const affected = Object.values(data.employees).filter((e) => e.skills[change.skillId] && (!change.departmentId || e.departmentId === change.departmentId)).length;
      return `Simulare: ${sk.name} expiră pentru ${affected} angajați${change.departmentId ? ` din ${data.departments[change.departmentId]?.name}` : ""}`;
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
    settings: {
      ...data.settings,
      rules: { ...data.settings.rules },
      staffingAdjustments: data.settings.staffingAdjustments.map((a) => ({ ...a })),
      absences: data.settings.absences.map((a) => ({ ...a })),
      expiredSkills: data.settings.expiredSkills.map((a) => ({ ...a })),
    },
  };
}
