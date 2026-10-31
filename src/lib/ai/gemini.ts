import { AiUnavailableError, type OllamaMessage, type OllamaToolCall, type ToolDef } from "./ollama";

/**
 * Google Gemini through its OpenAI-compatible endpoint.
 * Messages keep the internal (Ollama-shaped) format; this file converts them on the way in and out.
 */
export function geminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest",
    baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, ""),
    reasoningEffort: process.env.GEMINI_REASONING_EFFORT?.trim() ?? "low",
  };
}

type OaToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
type OaMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

/** Ollama-shaped history → OpenAI-shaped. Tool results get the id of the matching earlier call. */
function toOpenAi(messages: OllamaMessage[]): OaMessage[] {
  const out: OaMessage[] = [];
  let pending: { id: string; name: string }[] = [];
  let n = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      const calls: OaToolCall[] = (m.tool_calls ?? []).map((c) => ({
        id: c.id || `call_${++n}`,
        type: "function",
        function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) },
        ...(c.extra_content ? { extra_content: c.extra_content } : {}),
      }));
      pending = calls.map((c) => ({ id: c.id, name: c.function.name }));
      out.push({ role: "assistant", content: m.content || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m.role === "tool") {
      const i = pending.findIndex((p) => p.name === m.tool_name);
      const match = i >= 0 ? pending.splice(i, 1)[0] : pending.shift();
      if (!match) continue; // orphan tool result: Gemini would reject it
      out.push({ role: "tool", content: m.content, tool_call_id: match.id, name: match.name });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function fromOpenAi(msg: { content?: string | null; tool_calls?: OaToolCall[] }): OllamaMessage {
  const calls: OllamaToolCall[] = (msg.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      args = {};
    }
    return { id: c.id, function: { name: c.function.name, arguments: args }, ...(c.extra_content ? { extra_content: c.extra_content } : {}) };
  });
  return { role: "assistant", content: (msg.content ?? "").trim(), ...(calls.length ? { tool_calls: calls } : {}) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geminiChat(messages: OllamaMessage[], tools: ToolDef[]): Promise<OllamaMessage> {
  const { apiKey, model, baseUrl, reasoningEffort } = geminiConfig();
  if (!apiKey) throw new AiUnavailableError("GEMINI_API_KEY lipsește din .env (cheia se ia din Google AI Studio).");

  let effort = reasoningEffort;
  const body = () =>
    JSON.stringify({
      model,
      messages: toOpenAi(messages),
      ...(tools.length ? { tools } : {}),
      temperature: 0.2,
      ...(effort ? { reasoning_effort: effort } : {}),
    });

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: body(),
        signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 60_000)),
      });
    } catch (e) {
      throw new AiUnavailableError(`Gemini nu răspunde (internet?): ${(e as Error).message}`);
    }
    if (res.ok) {
      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new AiUnavailableError(`Gemini a răspuns fără mesaj: ${JSON.stringify(json).slice(0, 200)}`);
      return fromOpenAi(msg);
    }
    const text = await res.text().catch(() => "");
    // some models don't accept this reasoning_effort value: retry once without it
    if (res.status === 400 && effort && /reasoning|thinking/i.test(text)) {
      effort = "";
      continue;
    }
    // free tier: ~15 requests/minute. Wait and retry a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep([4000, 10_000, 20_000][attempt]);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new AiUnavailableError(`Cheia Gemini nu e acceptată (${res.status}). Verifică GEMINI_API_KEY. ${text.slice(0, 200)}`);
    if (res.status === 429) throw new AiUnavailableError(`Limita gratuită Gemini a fost atinsă. Mai încearcă peste un minut. ${text.slice(0, 200)}`);
    throw new AiUnavailableError(`Gemini a răspuns cu ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new AiUnavailableError("Gemini nu a răspuns după mai multe încercări.");
}

export async function geminiHealth(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { apiKey, baseUrl, model } = geminiConfig();
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY lipsește" };
  try {
    const r = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, models: [model] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
