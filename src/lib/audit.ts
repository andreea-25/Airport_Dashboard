import "server-only";
import { prisma } from "./db";

export async function audit(
  actorId: string | null,
  entity: string,
  entityId: string,
  action: string,
  diff?: unknown,
) {
  await prisma.auditLog.create({
    data: { actorId, entity, entityId, action, diff: diff === undefined ? undefined : JSON.parse(JSON.stringify(diff)) },
  });
}

/** Return only the fields that changed between two plain objects. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}
