"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertAdmin, assertSession } from "@/lib/auth";
import { createRequestFor } from "@/lib/services/employee";
import { audit } from "@/lib/audit";
import { ro } from "@/lib/i18n/ro";

const newRequest = z.object({
  type: z.enum(["SHIFT_SWAP", "LEAVE", "CAREER_INFO", "OTHER"]),
  details: z.string().trim().min(3).max(2000),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function submitRequest(_prev: unknown, fd: FormData) {
  const s = await assertSession();
  const parsed = newRequest.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Completează tipul și o descriere (minim 3 caractere)." };
  const { type, details, from, to } = parsed.data;
  await createRequestFor(s, type, { details, ...(from ? { from } : {}), ...(to ? { to } : {}) }, false);
  revalidatePath("/requests");
  return { ok: true };
}

const resolve = z.object({ id: z.string(), status: z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]), response: z.string().max(2000).optional() });

export async function resolveRequest(input: { id: string; status: "IN_REVIEW" | "APPROVED" | "REJECTED"; response?: string }) {
  const s = await assertAdmin();
  const { id, status, response } = resolve.parse(input);
  const before = await prisma.request.findUnique({ where: { id }, include: { employee: { include: { user: true } } } });
  if (!before) return { error: "Cerere inexistentă" };
  const after = await prisma.request.update({
    where: { id },
    data: { status, adminResponse: response?.trim() || before.adminResponse, resolvedAt: status === "IN_REVIEW" ? null : new Date() },
  });
  await audit(s.userId, "Request", id, "UPDATE_STATUS", { status: { from: before.status, to: status }, response });
  if (before.employee.user) {
    await prisma.notification.create({
      data: { userId: before.employee.user.id, type: "REQUEST_STATUS", refId: id, message: `${ro.notifications.requestStatus}: ${ro.requests.statuses[status]}` },
    });
  }
  revalidatePath("/admin/requests");
  return { ok: true, status: after.status };
}

export async function markNotificationsRead() {
  const s = await assertSession();
  await prisma.notification.updateMany({ where: { userId: s.userId, read: false }, data: { read: true } });
  revalidatePath("/notifications");
}
