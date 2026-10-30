import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { runAgent } from "@/lib/ai/agent";
import { AiUnavailableError } from "@/lib/ai/ollama";
import { ro } from "@/lib/i18n/ro";

const body = z.object({
  conversationId: z.string().nullish(),
  message: z.string().trim().min(1).max(2000),
  mode: z.enum(["EMPLOYEE", "ADMIN_SIM"]).default("EMPLOYEE"),
  scenarioId: z.string().nullish(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Cerere invalidă" }, { status: 400 });
  const { message, mode, scenarioId } = parsed.data;

  // role/mode checks happen here, on the server — not in the prompt
  if (mode === "ADMIN_SIM" && session.role !== "ADMIN") return NextResponse.json({ error: "Acces interzis" }, { status: 403 });
  if (mode === "EMPLOYEE" && !session.employeeId) return NextResponse.json({ error: "Contul nu este asociat unui angajat" }, { status: 403 });
  if (mode === "ADMIN_SIM" && !scenarioId) return NextResponse.json({ error: "Lipsește scenariul" }, { status: 400 });

  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const conv = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.userId !== session.userId || conv.mode !== mode) conversationId = null;
  }
  if (!conversationId) {
    conversationId = (await prisma.aiConversation.create({ data: { userId: session.userId, mode, scenarioId: mode === "ADMIN_SIM" ? scenarioId : null } })).id;
  }

  try {
    const r = await runAgent({ session, conversationId, mode, scenarioId: mode === "ADMIN_SIM" ? scenarioId : null, userMessage: message });
    return NextResponse.json({ conversationId, ...r });
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      console.error("[ai]", e.message);
      return NextResponse.json({ conversationId, error: ro.assistant.unavailable, detail: e.message }, { status: 503 });
    }
    console.error("[ai]", e);
    return NextResponse.json({ conversationId, error: ro.common.errorGeneric }, { status: 500 });
  }
}
