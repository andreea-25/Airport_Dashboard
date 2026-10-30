import { prisma } from "../db";
import type { Session } from "../auth";
import { skillGap } from "../sim/scenario";

/**
 * Employee-scoped data access. Every function takes the server session and filters on it,
 * so neither the UI nor the AI agent can read another employee's private data.
 */

export class AccessError extends Error {}

function requireEmployee(s: Session): string {
  if (!s.employeeId) throw new AccessError("Contul nu este asociat unui angajat");
  return s.employeeId;
}

const shiftInclude = {
  department: true,
  team: true,
  assignments: { include: { position: true, employee: { include: { level: true } } } },
} as const;

export async function getMyShifts(s: Session, from: Date, to: Date) {
  const employeeId = requireEmployee(s);
  return prisma.shift.findMany({
    where: { startAt: { gte: from, lt: to }, assignments: { some: { employeeId } } },
    include: shiftInclude,
    orderBy: { startAt: "asc" },
  });
}

/** Shifts of the employee's own team (visibility rule: team only). */
export async function getTeamShifts(s: Session, from: Date, to: Date) {
  const employeeId = requireEmployee(s);
  const me = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (!me.teamId) return [];
  return prisma.shift.findMany({
    where: { startAt: { gte: from, lt: to }, teamId: me.teamId },
    include: shiftInclude,
    orderBy: { startAt: "asc" },
  });
}

/** Admins see everything; employees see shifts they're in or that belong to their team. */
export async function canViewShift(s: Session, shiftId: string): Promise<boolean> {
  if (s.role === "ADMIN") return true;
  if (!s.employeeId) return false;
  const me = await prisma.employee.findUnique({ where: { id: s.employeeId } });
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { assignments: { select: { employeeId: true } } } });
  if (!shift || !me) return false;
  return shift.assignments.some((a) => a.employeeId === me.id) || (!!me.teamId && shift.teamId === me.teamId);
}

/** Shift detail with colleagues limited to public fields (name, level, position, lead). */
export async function getShiftDetail(s: Session, shiftId: string) {
  if (!(await canViewShift(s, shiftId))) throw new AccessError("Nu ai acces la această tură");
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: {
      department: true,
      team: true,
      assignments: { include: { position: true, employee: { include: { level: true } } } },
      comments: { include: { author: { include: { employee: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  return {
    id: shift.id,
    startAt: shift.startAt,
    endAt: shift.endAt,
    department: shift.department.name,
    team: shift.team?.name ?? null,
    colleagues: shift.assignments
      .map((a) => ({
        employeeId: a.employeeId,
        name: `${a.employee.firstName} ${a.employee.lastName}`,
        level: a.employee.level.name,
        levelRank: a.employee.level.rank,
        position: a.position?.name ?? null,
        isLead: a.isLead,
        isMe: a.employeeId === s.employeeId,
      }))
      .sort((a, b) => Number(b.isLead) - Number(a.isLead) || b.levelRank - a.levelRank),
    comments: shift.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.author.employee ? `${c.author.employee.firstName} ${c.author.employee.lastName}` : "Administrator",
      authorIsAdmin: c.author.role === "ADMIN",
    })),
  };
}

export async function getMyProfile(s: Session) {
  const employeeId = requireEmployee(s);
  return prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { department: true, team: true, level: true, skills: { include: { skill: true }, orderBy: { skill: { name: "asc" } } } },
  });
}

export async function getMyCareerGap(s: Session, targetLevelName?: string | null) {
  const employeeId = requireEmployee(s);
  let targetLevelId: string | null = null;
  if (targetLevelName) {
    const lvl = await prisma.level.findFirst({ where: { name: { equals: targetLevelName, mode: "insensitive" } } });
    targetLevelId = lvl?.id ?? null;
  }
  return skillGap(employeeId, { targetLevelId });
}

export async function getMyRequests(s: Session) {
  const employeeId = requireEmployee(s);
  return prisma.request.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
}

export async function createRequestFor(s: Session, type: "SHIFT_SWAP" | "LEAVE" | "CAREER_INFO" | "OTHER", payload: Record<string, unknown>, createdByAI: boolean) {
  const employeeId = requireEmployee(s);
  const req = await prisma.request.create({ data: { employeeId, type, payload: payload as object, createdByAI } });
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
  await prisma.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, type: "NEW_REQUEST", refId: req.id, message: `Cerere nouă de la ${emp.firstName} ${emp.lastName}` })),
  });
  await prisma.auditLog.create({ data: { actorId: s.userId, entity: "Request", entityId: req.id, action: createdByAI ? "CREATE_VIA_AI" : "CREATE", diff: { type, payload } as object } });
  return req;
}
