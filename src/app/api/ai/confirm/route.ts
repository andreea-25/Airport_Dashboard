import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createRequestFor } from "@/lib/services/employee";

const body = z.object({ messageId: z.string(), action: z.enum(["confirm", "cancel"]) });

/** The only path through which an AI-drafted request becomes a real Request: an explicit click by its owner. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Cerere invalidă" }, { status: 400 });

  const msg = await prisma.aiMessage.findUnique({ where: { id: parsed.data.messageId }, include: { conversation: true } });
  if (!msg || msg.conversation.userId !== session.userId || msg.role !== "tool") return NextResponse.json({ error: "Nu a fost găsit" }, { status: 404 });
  const meta = msg.toolCalls as { draft?: { type: "SHIFT_SWAP" | "LEAVE" | "CAREER_INFO" | "OTHER"; details: string; summary: string }; status?: string } | null;
  if (!meta?.draft || meta.status !== "PENDING") return NextResponse.json({ error: "Cererea a fost deja procesată" }, { status: 409 });

  if (parsed.data.action === "cancel") {
    await prisma.aiMessage.update({ where: { id: msg.id }, data: { toolCalls: { ...meta, status: "CANCELLED" } as object } });
    await prisma.aiMessage.create({ data: { conversationId: msg.conversationId, role: "user", content: "[Am anulat cererea propusă.]" } });
    return NextResponse.json({ ok: true, status: "CANCELLED" });
  }
  const request = await createRequestFor(session, meta.draft.type, { summary: meta.draft.summary, details: meta.draft.details }, true);
  await prisma.aiMessage.update({ where: { id: msg.id }, data: { toolCalls: { ...meta, status: "CONFIRMED", requestId: request.id } as object } });
  await prisma.aiMessage.create({ data: { conversationId: msg.conversationId, role: "user", content: "[Am confirmat cererea; a fost trimisă administratorului.]" } });
  return NextResponse.json({ ok: true, status: "CONFIRMED", requestId: request.id });
}
