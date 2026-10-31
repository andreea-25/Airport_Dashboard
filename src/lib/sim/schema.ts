import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:mm");

/** Runtime validation for changes coming from the UI or the AI. */
export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MOVE_EMPLOYEE_TEAM"), employeeId: z.string(), teamId: z.string() }),
  z.object({ type: z.literal("SWAP_TEAMS"), teamAId: z.string(), teamBId: z.string() }),
  z.object({ type: z.literal("MOVE_ASSIGNMENT"), assignmentId: z.string(), toShiftId: z.string() }),
  z.object({
    type: z.literal("ADD_ASSIGNMENT"),
    shiftId: z.string(),
    employeeId: z.string(),
    positionId: z.string().nullish(),
    isLead: z.boolean().optional(),
  }),
  z.object({ type: z.literal("REMOVE_ASSIGNMENT"), assignmentId: z.string() }),
  z.object({
    type: z.literal("CHANGE_SHIFT_HOURS"),
    departmentId: z.string(),
    teamId: z.string().nullish(),
    fromStart: time.nullish(),
    shiftId: z.string().nullish(),
    startTime: time,
    endTime: time,
  }),
  z.object({ type: z.literal("SET_EMPLOYEE_LEVEL"), employeeId: z.string(), levelId: z.string() }),
  z.object({ type: z.literal("SET_ASSIGNMENT"), assignmentId: z.string(), positionId: z.string().nullish(), isLead: z.boolean().optional() }),
  z.object({
    type: z.literal("SET_RULES"),
    rules: z.object({
      minRestHours: z.coerce.number().optional(),
      maxWeeklyHours: z.coerce.number().optional(),
      normalWeeklyHours: z.coerce.number().optional(),
      leadMinRank: z.coerce.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal("ADJUST_STAFFING"),
    departmentId: z.string().nullish(),
    startHour: z.coerce.number().int(),
    endHour: z.coerce.number().int(),
    factor: z.coerce.number(),
    label: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("REMOVE_STAFFING_ADJUSTMENT"), id: z.string() }),
  z.object({
    type: z.literal("ADD_ABSENCE"),
    employeeId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.coerce.number().int().min(1).max(31).optional(),
    reason: z.string().max(100).optional(),
  }),
  z.object({ type: z.literal("EXPIRE_SKILL"), skillId: z.string(), departmentId: z.string().nullish() }),
]);
