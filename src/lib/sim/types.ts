export type SimAssignment = {
  id: string;
  employeeId: string;
  positionId: string | null;
  isLead: boolean;
};

export type SimShift = {
  id: string;
  sourceShiftId?: string | null;
  departmentId: string;
  teamId: string | null;
  startAt: Date;
  endAt: Date;
  assignments: SimAssignment[];
};

export type SimEmployeeSkill = { proficiency: number; expiresAt: Date | null };

export type SimEmployee = {
  id: string;
  name: string;
  departmentId: string;
  teamId: string | null;
  levelId: string;
  levelRank: number;
  levelName: string;
  skills: Record<string, SimEmployeeSkill>; // skillId -> skill
};

export type SimPosition = {
  id: string;
  name: string;
  departmentId: string;
  skills: { skillId: string; minProficiency: number }[];
};

export type SimStaffing = { departmentId: string; dayOfWeek: number; startHour: number; endHour: number; minStaff: number };

export type SimOverride = { teamId?: string | null; departmentId?: string | null; levelId?: string | null };

/** Simulation rules, configurable per scenario. */
export type SimRules = {
  minRestHours: number;
  maxWeeklyHours: number;
  normalWeeklyHours: number;
  leadMinRank: number; // 3 = Senior
};

/** "+30% flights in the morning": multiplies the staffing need in a time window. */
export type StaffingAdjustment = { id: string; departmentId: string | null; startHour: number; endHour: number; factor: number; label: string };
export type Absence = { employeeId: string; date: string; reason: string };
/** A skill treated as expired during the scenario period ("what if AVSEC certificates expire"). */
export type SkillExpiry = { skillId: string; departmentId: string | null };

export type ScenarioSettings = {
  rules: SimRules;
  staffingAdjustments: StaffingAdjustment[];
  absences: Absence[];
  expiredSkills: SkillExpiry[];
  appliedAt?: string | null;
};

export const DEFAULT_RULES: SimRules = { minRestHours: 12, maxWeeklyHours: 48, normalWeeklyHours: 40, leadMinRank: 3 };

export function defaultSettings(): ScenarioSettings {
  return { rules: { ...DEFAULT_RULES }, staffingAdjustments: [], absences: [], expiredSkills: [], appliedAt: null };
}

export function normalizeSettings(raw: unknown): ScenarioSettings {
  const s = (raw ?? {}) as Partial<ScenarioSettings>;
  return {
    rules: { ...DEFAULT_RULES, ...(s.rules ?? {}) },
    staffingAdjustments: s.staffingAdjustments ?? [],
    absences: s.absences ?? [],
    expiredSkills: s.expiredSkills ?? [],
    appliedAt: s.appliedAt ?? null,
  };
}

export type SimData = {
  settings: ScenarioSettings;
  periodStart: Date;
  periodEnd: Date;
  shifts: SimShift[];
  employees: Record<string, SimEmployee>;
  positions: Record<string, SimPosition>;
  staffing: SimStaffing[];
  departments: Record<string, { id: string; name: string; code: string }>;
  teams: Record<string, { id: string; name: string; departmentId: string }>;
  levels: Record<string, { id: string; name: string; rank: number }>;
  skills: Record<string, { id: string; name: string; code: string; type: string }>;
  overrides: Record<string, SimOverride>;
};

export type CoverageSlot = {
  departmentId: string;
  slotStart: string; // ISO
  slotEnd: string;
  required: number;
  assigned: number;
  pct: number;
};

export type Violation = {
  type: "REST_TOO_SHORT" | "WEEKLY_HOURS" | "OVERLAP" | "MISSING_CERT" | "NO_LEAD" | "ABSENT_ASSIGNED";
  employeeId?: string;
  shiftId?: string;
  departmentId?: string;
  message: string;
};

export type Evaluation = {
  coverage: CoverageSlot[];
  coverageByDept: { departmentId: string; name: string; avgPct: number; understaffedSlots: number; totalSlots: number }[];
  coverageByHour: { departmentId: string; hour: number; avgPct: number; minPct: number }[];
  hours: { employeeId: string; name: string; total: number; overtime: number }[];
  violations: Violation[];
  skillMismatches: { employeeId: string; name: string; positionId: string; positionName: string; shiftId: string; missingSkills: string[] }[];
  expiringCertifications: { employeeId: string; name: string; skillId: string; skillName: string; expiresAt: string; expired: boolean }[];
  fairness: {
    perEmployee: { employeeId: string; name: string; departmentId: string; hours: number; nights: number; weekends: number }[];
    byDept: { departmentId: string; name: string; people: number; avgNights: number; maxNights: number; avgWeekends: number; maxWeekends: number; hoursSpread: number }[];
  };
  score: ScoreBreakdown;
  summary: {
    score: number;
    avgCoverage: number;
    understaffedSlots: number;
    totalHours: number;
    totalOvertime: number;
    violationCount: number;
    mismatchCount: number;
    expiringCount: number;
    shiftCount: number;
  };
};

export type ScoreBreakdown = { total: number; coverage: number; violations: number; overtime: number; certifications: number };

/** Changes understood by the simulation engine. Both the UI and the AI produce these. */
export type Change =
  | { type: "MOVE_EMPLOYEE_TEAM"; employeeId: string; teamId: string }
  | { type: "SWAP_TEAMS"; teamAId: string; teamBId: string }
  | { type: "MOVE_ASSIGNMENT"; assignmentId: string; toShiftId: string }
  | { type: "ADD_ASSIGNMENT"; shiftId: string; employeeId: string; positionId?: string | null; isLead?: boolean }
  | { type: "REMOVE_ASSIGNMENT"; assignmentId: string }
  | {
      type: "CHANGE_SHIFT_HOURS";
      departmentId: string;
      teamId?: string | null;
      /** only shifts that currently start at this local time ("HH:mm"); omit for all */
      fromStart?: string | null;
      /** only this shift */
      shiftId?: string | null;
      startTime: string;
      endTime: string;
    }
  | { type: "SET_EMPLOYEE_LEVEL"; employeeId: string; levelId: string }
  | { type: "SET_ASSIGNMENT"; assignmentId: string; positionId?: string | null; isLead?: boolean }
  | { type: "SET_RULES"; rules: Partial<SimRules> }
  | { type: "ADJUST_STAFFING"; departmentId?: string | null; startHour: number; endHour: number; factor: number; label?: string }
  | { type: "REMOVE_STAFFING_ADJUSTMENT"; id: string }
  | { type: "ADD_ABSENCE"; employeeId: string; date: string; days?: number; reason?: string }
  | { type: "EXPIRE_SKILL"; skillId: string; departmentId?: string | null };

export type ChangeType = Change["type"];
