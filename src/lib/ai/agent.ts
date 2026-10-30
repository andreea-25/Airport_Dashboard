import { prisma } from "../db";
import type { Session } from "../auth";
import { fmt } from "../time";
import { ollamaChat, ollamaConfig, type OllamaMessage } from "./ollama";
import { toolsFor, type ToolContext } from "./tools";

const MAX_STEPS = 6;

function systemPrompt(mode: "EMPLOYEE" | "ADMIN_SIM", who: string) {
  const now = fmt(new Date(), "EEEE, dd.MM.yyyy HH:mm");
  const common = `Ești asistentul pentru personalul Aeroportului Regional Craiova. Data și ora curentă: ${now} (Europe/Bucharest).
Răspunzi DOAR în limba română, scurt și clar.
Reguli obligatorii:
- Folosești doar datele returnate de unelte. Nu inventezi ture, nume, cifre sau skill-uri. Dacă nu ai date, spui asta.
- Cifrele (acoperire, ore, încălcări) sunt calculate de sistem; tu doar le interpretezi.
- Nu ai acces la datele personale ale altor angajați și nu le ceri.
- Nu poți modifica direct ture sau angajați.`;
  if (mode === "EMPLOYEE") {
    return `${common}
Rol curent: ANGAJAT (${who}). Toate uneltele întorc doar datele acestui utilizator și ale echipei lui.
- Pentru întrebări despre ture folosește get_my_shifts (calculează tu datele YYYY-MM-DD pornind de la data curentă).
- Pentru avansare folosește get_my_career_gap.
- Când utilizatorul vrea să trimită o cerere (schimb de tură, concediu, informații despre curs/avansare, altceva), apelează create_request cu un rezumat clar. Sistemul îi arată utilizatorului un buton „Confirmă”; cererea se trimite doar după ce apasă. Spune-i asta.`;
  }
  return `${common}
Rol curent: ADMINISTRATOR, în modul de SIMULARE. Lucrezi pe o copie (scenariu); programul real nu e atins.
Pași recomandați: 1) get_scenario_summary; 2) list_shifts / list_employees pentru ID-uri; 3) preview_change pentru a verifica impactul; 4) propose_changes cu 1–3 sugestii concrete și o justificare.
- Folosește exact ID-urile primite de la unelte.
- O sugestie bună crește acoperirea sau reduce încălcările fără să creeze altele noi (repaus 12h, maxim 48h/săptămână, lider ≥ Senior, certificări valide).
- După propose_changes, explică pe scurt fiecare sugestie și impactul ei calculat de motor.`;
}

export type AgentResult = {
  reply: string;
  toolCalls: { name: string; args: unknown; ok: boolean }[];
  pendingRequestMessageId?: string;
  pendingRequest?: { type: string; details: string; summary: string };
};

/** Load the stored conversation as Ollama messages (last N to stay within 8k context). */
async function history(conversationId: string): Promise<OllamaMessage[]> {
  const msgs = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const out: OllamaMessage[] = [];
  for (const m of msgs.slice(-24)) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const tc = (m.toolCalls as { calls?: OllamaMessage["tool_calls"] } | null)?.calls;
      out.push({ role: "assistant", content: m.content, ...(tc?.length ? { tool_calls: tc } : {}) });
    } else if (m.role === "tool") {
      out.push({ role: "tool", content: m.content.slice(0, 6000), tool_name: (m.toolCalls as { name?: string } | null)?.name });
    }
  }
  // never start with an orphan tool message
  while (out.length && out[0].role === "tool") out.shift();
  return out;
}

export async function runAgent(opts: { session: Session; conversationId: string; mode: "EMPLOYEE" | "ADMIN_SIM"; scenarioId?: string | null; userMessage: string }): Promise<AgentResult> {
  const { session, conversationId, mode, scenarioId } = opts;
  const { defs, exec } = toolsFor(mode);
  const ctx: ToolContext = { session, conversationId, scenarioId };

  let who = session.email;
  if (session.employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: session.employeeId }, include: { department: true } });
    if (e) who = `${e.firstName} ${e.lastName}, ${e.department.name}`;
  }

  await prisma.aiMessage.create({ data: { conversationId, role: "user", content: opts.userMessage } });
  const messages: OllamaMessage[] = [{ role: "system", content: systemPrompt(mode, who) }, ...(await history(conversationId))];
  const used: AgentResult["toolCalls"] = [];
  let pending: AgentResult["pendingRequest"];
  let pendingId: string | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await ollamaChat(messages, defs);
    const calls = reply.tool_calls ?? [];
    await prisma.aiMessage.create({
      data: { conversationId, role: "assistant", content: reply.content ?? "", toolCalls: calls.length ? ({ calls, model: ollamaConfig().model } as object) : undefined },
    });
    messages.push({ role: "assistant", content: reply.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      return { reply: reply.content || "(fără răspuns)", toolCalls: used, pendingRequest: pending, pendingRequestMessageId: pendingId };
    }
    for (const call of calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments ?? {};
      } catch {
        args = {};
      }
      let content: string;
      let ok = true;
      let extra: Record<string, unknown> = {};
      const fnExec = exec[name];
      if (!fnExec) {
        ok = false;
        content = JSON.stringify({ eroare: `Unealtă necunoscută: ${name}` });
      } else {
        try {
          const r = await fnExec(args, ctx);
          content = JSON.stringify(r.result);
          if (r.pendingRequest) {
            pending = r.pendingRequest;
            extra = { draft: r.pendingRequest, status: "PENDING" };
          }
        } catch (e) {
          ok = false;
          content = JSON.stringify({ eroare: (e as Error).message });
        }
      }
      used.push({ name, args, ok });
      const saved = await prisma.aiMessage.create({ data: { conversationId, role: "tool", content, toolCalls: { name, args, ok, ...extra } as object } });
      if (extra.draft) pendingId = saved.id;
      messages.push({ role: "tool", content: content.slice(0, 6000), tool_name: name });
    }
  }
  return { reply: "Am atins limita de pași pentru această întrebare. Încearcă să o reformulezi mai concret.", toolCalls: used, pendingRequest: pending, pendingRequestMessageId: pendingId };
}
