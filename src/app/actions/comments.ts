"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertSession } from "@/lib/auth";
import { canViewShift } from "@/lib/services/employee";
import { audit } from "@/lib/audit";

const COMMENT_DELETE_WINDOW_MIN = 10;

export async function addComment(shiftId: string, body: string, parentId?: string | null) {
  const s = await assertSession();
  const text = body.trim();
  if (!text || text.length > 2000) return { error: "Comentariul trebuie să aibă între 1 și 2000 de caractere." };
  if (!(await canViewShift(s, shiftId))) return { error: "Nu ai acces la această tură." };
  if (parentId) {
    const parent = await prisma.shiftComment.findUnique({ where: { id: parentId } });
    if (!parent || parent.shiftId !== shiftId) return { error: "Comentariu părinte invalid." };
  }
  const c = await prisma.shiftComment.create({ data: { shiftId, authorId: s.userId, body: text, parentId: parentId ?? null } });
  await audit(s.userId, "ShiftComment", c.id, "CREATE", { shiftId, parentId });

  // notify: admins on employee comments, the original author on admin replies
  if (s.role !== "ADMIN") {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: "NEW_COMMENT", refId: shiftId, message: "Comentariu nou pe o tură" })) });
  } else if (parentId) {
    const parent = await prisma.shiftComment.findUnique({ where: { id: parentId } });
    if (parent && parent.authorId !== s.userId) {
      await prisma.notification.create({ data: { userId: parent.authorId, type: "COMMENT_REPLY", refId: shiftId, message: "Administratorul a răspuns la comentariul tău" } });
    }
  }
  revalidatePath(`/shifts/${shiftId}`);
  revalidatePath("/admin/comments");
  return { ok: true };
}

/** Authors may delete their own comment only within the first 10 minutes. Shift data is never touched. */
export async function deleteComment(commentId: string) {
  const s = await assertSession();
  const c = await prisma.shiftComment.findUnique({ where: { id: commentId } });
  if (!c) return { error: "Comentariu inexistent." };
  if (c.authorId !== s.userId) return { error: "Poți șterge doar comentariile tale." };
  if (Date.now() - c.createdAt.getTime() > COMMENT_DELETE_WINDOW_MIN * 60_000) return { error: "Fereastra de ștergere a expirat." };
  await prisma.shiftComment.delete({ where: { id: commentId } });
  await audit(s.userId, "ShiftComment", commentId, "DELETE", { body: c.body });
  revalidatePath(`/shifts/${c.shiftId}`);
  return { ok: true };
}
