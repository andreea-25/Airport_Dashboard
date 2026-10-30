import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { runAgent } from "@/lib/ai/agent";
import { AiUnavailableError } from "@/lib/ai/ollama";
import { ruleBasedSuggestions } from "@/lib/ai/rules";
import { audit } from "@/lib/audit";
import { ro } from "@/lib/i18n/ro";

const body = z.object({ scenarioId: z.string(), prompt: z.string().max(1000).optional(), conversationId: z.string().nullish() });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Acces interzis" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Cerere invalidă" }, { status: 400 });
  const { scenarioId, prompt } = parsed.data;
  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario) return NextResponse.json({ error: "Scenariu inexistent" }, { status: 404 });

  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const c = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (!c || c.userId !== session.userId || c.scenarioId !== scenarioId) conversationId = null;
  }
  conversationId ??= (await prisma.aiConversation.create({ data: { userId: session.userId, mode: "ADMIN_SIM", scenarioId } })).id;

  const before = new Date();
  const message = prompt?.trim()
    ? prompt.trim()
    : "Analizează scenariul curent și propune 1–3 îmbunătățiri concrete (cu propose_changes) care cresc acoperirea sau reduc încălcările de reguli.";
  try {
    const r = await runAgent({ session, conversationId, mode: "ADMIN_SIM", scenarioId, userMessage: message });
    const created = await prisma.scenarioSuggestion.count({ where: { scenarioId, createdAt: { gte: before } } });
    await audit(session.userId, "Scenario", scenarioId, "AI_SUGGEST", { prompt: message, created, tools: r.toolCalls.map((t) => t.name) });
    return NextResponse.json({ source: "AI", conversationId, reply: r.reply, created, toolCalls: r.toolCalls });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) {
      console.error("[ai-sim]", e);
      return NextResponse.json({ error: ro.common.errorGeneric }, { status: 500 });
    }
    const saved = await ruleBasedSuggestions(scenarioId);
    await audit(session.userId, "Scenario", scenarioId, "RULES_SUGGEST", { created: saved.length, reason: e.message });
    return NextResponse.json({ source: "RULES", conversationId, reply: ro.sim.rulesFallback, created: saved.length });
  }
}
