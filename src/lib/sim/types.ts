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

export type SimData = {
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
  type: "REST_TOO_SHORT" | "WEEKLY_HOURS" | "OVERLAP" | "MISSING_CERT" | "NO_LEAD";
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
  summary: {
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
  | { type: "SET_EMPLOYEE_LEVEL"; employeeId: string; levelId: string };

export type ChangeType = Change["type"];
