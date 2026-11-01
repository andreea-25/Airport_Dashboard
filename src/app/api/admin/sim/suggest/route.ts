import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { runAgent } from "@/lib/ai/agent";
import { AiUnavailableError } from "@/lib/ai/ollama";
import { saveOptimizerSuggestions } from "@/lib/sim/suggestions";
import { audit } from "@/lib/audit";
import { ro } from "@/lib/i18n/ro";

const body = z.object({ scenarioId: z.string(), prompt: z.string().max(1000).optional(), conversationId: z.string().nullish() });

export async function POST(req: Request) {
  // never answer with an empty 500: the panel shows `error` + `detail`
  try {
    return await handle(req);
  } catch (e) {
    console.error("[ai-sim] unhandled", e);
    return NextResponse.json({ error: ro.common.errorGeneric, detail: (e as Error)?.message ?? String(e) }, { status: 500 });
  }
}

async function handle(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Acces interzis" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Cerere invalidă" }, { status: 400 });
  const { scenarioId, prompt } = parsed.data;
  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario) return NextResponse.json({ error: "Scenariu inexistent" }, { status: 404 });

  // one saved conversation per admin and scenario (the latest one); "new conversation" deletes it
  const existing = await prisma.aiConversation.findFirst({ where: { userId: session.userId, scenarioId, mode: "ADMIN_SIM" }, orderBy: { createdAt: "desc" } });
  const conversationId = existing?.id ?? (await prisma.aiConversation.create({ data: { userId: session.userId, mode: "ADMIN_SIM", scenarioId } })).id;

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
      return NextResponse.json({ error: ro.common.errorGeneric, detail: (e as Error).message }, { status: 500 });
    }
    console.error("[ai-sim] AI indisponibil:", e.message);
    let saved: number;
    try {
      saved = await saveOptimizerSuggestions(scenarioId, 3);
    } catch (e2) {
      console.error("[ai-sim] optimizer fallback failed", e2);
      return NextResponse.json({ error: ro.assistant.unavailable, detail: `${e.message} · optimizator: ${(e2 as Error).message}` }, { status: 503 });
    }
    await audit(session.userId, "Scenario", scenarioId, "OPTIMIZER_SUGGEST", { created: saved, reason: e.message });
    const reply = `${ro.sim.rulesFallback}\nMotiv: ${e.message}`;
    // saved in the chat history, but never sent to the model (role "notice")
    await prisma.aiMessage.create({ data: { conversationId, role: "notice", content: reply } });
    return NextResponse.json({ source: "OPTIMIZER", conversationId, reply, created: saved });
  }
}
