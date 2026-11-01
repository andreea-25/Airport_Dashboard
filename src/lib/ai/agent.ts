import { prisma } from "../db";
import type { Session } from "../auth";
import { fmt, promptCalendar } from "../time";
import type { OllamaMessage } from "./ollama";
import { llmChat, llmConfig } from "./llm";
import { toolsFor, type ToolContext } from "./tools";

const MAX_STEPS = 6;
/** Earlier questions kept in the prompt (only the question and the final answer, not tool results). */
const MAX_PAST_TURNS = 4;

/** System prompt (exported so the training-data generator uses exactly the same text). */
export function systemPrompt(mode: "EMPLOYEE" | "ADMIN_SIM", who: string, at: Date = new Date()) {
  const now = fmt(at, "EEEE, dd.MM.yyyy HH:mm");
  const common = `Ești asistentul pentru personalul Aeroportului Regional Craiova. Data și ora curentă: ${now} (Europe/Bucharest).
Răspunzi DOAR în limba română, scurt și clar.
Reguli obligatorii:
- Folosești doar datele returnate de unelte. Nu inventezi ture, nume, cifre sau skill-uri. Dacă nu ai date, spui asta.
- Cifrele (acoperire, ore, încălcări) sunt calculate de sistem; tu doar le interpretezi.
- Nu ai acces la datele personale ale altor angajați și nu le ceri.
- Ia in calcul că utilizatorii pot scrie și fără diacritice, cu majuscule sau minuscule, cu spații în plus sau cu greșeli de tastare. Caută să înțelegi ce au vrut să scrie.
- Nu poți modifica direct ture sau angajați.`;
  if (mode === "EMPLOYEE") {
    return `${common}
Rol curent: ANGAJAT (${who}). Uneltele întorc doar datele acestui utilizator și ale echipei lui.

Calendar (calculat de sistem — copiază de aici, nu calcula singur datele):
${promptCalendar(at)}

Reguli pentru ture:
- Pentru „azi”, „mâine”, „weekend”, „săptămâna asta/viitoare” apelezi get_my_shifts cu period (ex. {"period":"weekend"}). Pentru o zi anume (ex. „pe 12.11”) dai from și to cu data din calendar/întrebare.
- „Cine e cu mine / cine e liderul la tura X”: întâi get_my_shifts, apoi get_shift_colleagues cu shift_id-ul turei.

Alte reguli:
- Avansare („ce îmi lipsește”, „pot fi promovat”): get_my_career_gap (cu target_level dacă e numit un nivel).
- Certificări, echipă, nivel: get_my_profile. Statusul cererilor: get_my_requests.
- Când utilizatorul cere să trimiți/faci o cerere (concediu, liber, schimb de tură, curs, informații) apelezi DIRECT create_request — nu verifica alte unelte înainte. Spune-i că trebuie să apese „Confirmă”.
- Dacă întreabă despre ALTĂ persoană (ture, date personale, telefon, certificări, salariu, cereri): refuzi politicos și NU apelezi nicio unealtă. get_my_shifts arată doar turele utilizatorului, nu ale altora.
- La salut sau mulțumiri răspunzi scurt, fără unelte.`;
  }
  return `${common}
Rol curent: ADMINISTRATOR, în modul de SIMULARE. Lucrezi pe o copie (scenariu); programul real nu e atins.
Rolul tău: ești analistul. Un optimizator (cod) caută variantele și calculează impactul; tu alegi, combini și explici.
Pași:
1) find_improvements (cu department_code dacă adminul se referă la un departament, cu exclude_employee_names dacă adminul nu vrea să fie mutat cineva).
2) Alege 1–3 candidați care se completează (ex. unul pentru acoperire, unul pentru lider lipsă). Evită doi candidați care mută aceeași persoană.
3) propose_changes cu candidate_ids și o justificare scurtă.
4) Răspunde adminului: pentru fiecare sugestie, ce schimbă, de ce, și impactul (scor, acoperire, încălcări) exact cum l-au dat uneltele.
Dacă adminul refuză o variantă („nu vreau să-l mut pe X”), rulează din nou find_improvements cu exclude_employee_names=["X"].
Când adminul răspunde la întrebările tale despre un scenariu (departament, obiectiv, perioadă, oameni de nemutat), folosește răspunsurile ca parametri pentru find_improvements, apoi salvează cu propose_changes. Dacă un răspuns lipsește, alege varianta rezonabilă (ex. toate departamentele) și spune ce ai ales; întreabă din nou doar dacă cererea e cu adevărat neclară.
Pentru întrebări despre scenariu fără cerere de sugestii, folosește get_scenario_summary / evaluate_scenario.
Pentru ce îi lipsește unui angajat: get_employee_skill_gap cu employee_name (numele, așa cum l-a scris adminul).
Pentru echilibrul echipei („pe cine mă pot baza”, „cine e pe roșu”, „ce departament are probleme”): get_team_readiness (department_code și horizon_days dacă adminul le spune).
Când cineva pleacă sau lipsește („demisionează X”, „ce fac dacă pleacă X”, „cu cine îl înlocuiesc pe X”): propose_replacements cu employee_name. Prezintă 2–3 variante fezabile, cu pașii și avertismentele lor; spune clar când o variantă nu e fezabilă și de ce. Prelungirea cere acordul persoanei — formulează ca propunere.

Exemplu:
Admin: „Rezolvă golurile de la securitate, dar nu-l muta pe Popescu.”
Tu: apelezi find_improvements {"department_code":"SEC","exclude_employee_names":["Popescu"]}, apoi propose_changes {"candidate_ids":["C1","C3"],"rationale":"..."}, apoi răspunzi:
„Am salvat 1 sugestie (2 modificări): (1) C1 – Ana Marin intră în tura de marți 14–22, unde lipsea un om; (2) C3 – … Scorul crește de la 53,0 la 54,1, intervalele sub necesar scad de la 150 la 146. Popescu nu a fost mutat. O poți aplica din panoul Sugestii.”`;
}

export async function describeUser(session: Session) {
  if (session.employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: session.employeeId }, include: { department: true } });
    if (e) return `${e.firstName} ${e.lastName}, ${e.department.name}`;
  }
  return session.email;
}

export type AgentResult = {
  reply: string;
  toolCalls: { name: string; args: unknown; ok: boolean }[];
  pendingRequestMessageId?: string;
  pendingRequest?: { type: string; details: string; summary: string };
};

/**
 * Load the stored conversation for the model.
 * Earlier questions: only the user message and the final answer (old tool results are large and
 * would push the system prompt out of a small context). Current question: everything.
 */
async function history(conversationId: string): Promise<OllamaMessage[]> {
  const msgs = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: -200 });
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const past: OllamaMessage[][] = [];
  for (const m of lastUser >= 0 ? msgs.slice(0, lastUser) : []) {
    if (m.role === "user") past.push([{ role: "user", content: m.content }]);
    else if (m.role === "assistant" && past.length && m.content.trim() && !(m.toolCalls as { calls?: unknown[] } | null)?.calls?.length) {
      past[past.length - 1].push({ role: "assistant", content: m.content });
    }
  }
  const current: OllamaMessage[] = [];
  for (const m of lastUser >= 0 ? msgs.slice(lastUser) : []) {
    if (m.role === "user") current.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const tc = (m.toolCalls as { calls?: OllamaMessage["tool_calls"] } | null)?.calls;
      current.push({ role: "assistant", content: m.content, ...(tc?.length ? { tool_calls: tc } : {}) });
    } else if (m.role === "tool") {
      current.push({ role: "tool", content: m.content.slice(0, 6000), tool_name: (m.toolCalls as { name?: string } | null)?.name });
    }
  }
  return [...past.slice(-MAX_PAST_TURNS).flat(), ...current];
}

/**
 * Keep the prompt within the model's context: drop the oldest past messages first, then shorten
 * tool results. The system prompt (index 0) and the current question are never dropped.
 */
function fitToBudget(messages: OllamaMessage[], toolsChars: number): OllamaMessage[] {
  const budget = llmConfig().maxPromptChars - toolsChars;
  const size = (ms: OllamaMessage[]) => ms.reduce((n, m) => n + m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  const out = [...messages];
  const currentStart = () => out.map((m) => m.role).lastIndexOf("user");
  while (size(out) > budget && currentStart() > 1) out.splice(1, 1);
  for (const limit of [3000, 1500, 600]) {
    if (size(out) <= budget) break;
    for (let i = 0; i < out.length; i++) if (out[i].role === "tool" && out[i].content.length > limit) out[i] = { ...out[i], content: out[i].content.slice(0, limit) + " …(trunchiat)" };
  }
  return out;
}

export async function runAgent(opts: { session: Session; conversationId: string; mode: "EMPLOYEE" | "ADMIN_SIM"; scenarioId?: string | null; userMessage: string }): Promise<AgentResult> {
  const { session, conversationId, mode, scenarioId } = opts;
  const { defs, exec } = toolsFor(mode);
  const ctx: ToolContext = { session, conversationId, scenarioId };

  const who = await describeUser(session);

  await prisma.aiMessage.create({ data: { conversationId, role: "user", content: opts.userMessage } });
  const messages: OllamaMessage[] = [{ role: "system", content: systemPrompt(mode, who) }, ...(await history(conversationId))];
  const used: AgentResult["toolCalls"] = [];
  const toolsChars = JSON.stringify(defs).length;
  let pending: AgentResult["pendingRequest"];
  let pendingId: string | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    const { message: reply, provider, model } = await llmChat(fitToBudget(messages, toolsChars), defs);
    const calls = reply.tool_calls ?? [];
    await prisma.aiMessage.create({
      data: { conversationId, role: "assistant", content: reply.content ?? "", toolCalls: calls.length ? ({ calls, model, provider } as object) : undefined },
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
          if (r.meta) extra = { ...extra, meta: r.meta };
          if (r.pendingRequest) {
            pending = r.pendingRequest;
            extra = { ...extra, draft: r.pendingRequest, status: "PENDING" };
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
