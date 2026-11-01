import { AiUnavailableError, type OllamaMessage, type OllamaToolCall, type ToolDef } from "./ollama";

/**
 * Google Gemini through its native REST API (generateContent).
 * The key goes in the x-goog-api-key header, which works for both "AIza…" and the newer "AQ.…" keys
 * (the OpenAI-compatible endpoint only takes a Bearer header, which AQ keys don't always pass).
 * Messages keep the internal (Ollama-shaped) format; this file converts them on the way in and out.
 */
export function geminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    model: (process.env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest").replace(/^models\//, ""),
    /** tried in order when the main model is overloaded (503), out of quota (429) or too slow */
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash-lite")
      .split(",")
      .map((m) => m.trim().replace(/^models\//, ""))
      .filter(Boolean),
    baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
    /** "low" | "medium" | "high" | "" (model default) — less thinking = faster answers */
    thinkingLevel: process.env.GEMINI_THINKING_LEVEL?.trim() ?? "low",
  };
}

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};
type Content = { role: "user" | "model"; parts: Part[] };

const signatureOf = (c: OllamaToolCall) => (c.extra_content as { google?: { thought_signature?: string } } | undefined)?.google?.thought_signature;

/** Tool results must be JSON objects for Gemini. */
function asResponse(content: string): Record<string, unknown> {
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { result: v };
  } catch {
    return { result: content }; // e.g. a truncated result
  }
}

/** Ollama-shaped history → Gemini contents (+ system instruction). Consecutive tool results become one turn. */
export function toGemini(messages: OllamaMessage[]): { system: string; contents: Content[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: Content[] = [];
  let lastWasTool = false;
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const part: Part = { functionResponse: { name: m.tool_name || "tool", response: asResponse(m.content) } };
      const prev = contents[contents.length - 1];
      if (lastWasTool && prev?.role === "user") prev.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
      lastWasTool = true;
      continue;
    }
    lastWasTool = false;
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content || " " }] });
    } else {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      (m.tool_calls ?? []).forEach((c, i) => {
        const args = typeof c.function.arguments === "string" ? asResponse(c.function.arguments) : c.function.arguments ?? {};
        // Gemini 3 wants a signature on the first call of a turn; Google documents this placeholder for calls made elsewhere
        const sig = signatureOf(c) ?? (i === 0 ? "skip_thought_signature_validator" : undefined);
        parts.push({ functionCall: { name: c.function.name, args }, ...(sig ? { thoughtSignature: sig } : {}) });
      });
      if (parts.length) contents.push({ role: "model", parts });
    }
  }
  return { system, contents };
}

type GeminiResponse = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };

export function fromGemini(json: GeminiResponse): OllamaMessage {
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  if (!parts.length) {
    const why = json.promptFeedback?.blockReason || cand?.finishReason || "fără conținut";
    throw new AiUnavailableError(`Gemini nu a dat un răspuns (${why}).`);
  }
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  const calls: OllamaToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({
      id: `call_${Date.now().toString(36)}_${i}`,
      function: { name: p.functionCall!.name, arguments: p.functionCall!.args ?? {} },
      ...(p.thoughtSignature ? { extra_content: { google: { thought_signature: p.thoughtSignature } } } : {}),
    }));
  return { role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Error worth retrying on another model (overload, quota, timeout). */
class GeminiBusyError extends AiUnavailableError {}

export async function geminiChat(messages: OllamaMessage[], tools: ToolDef[]): Promise<OllamaMessage> {
  const { apiKey, model, fallbackModels } = geminiConfig();
  if (!apiKey) throw new AiUnavailableError("GEMINI_API_KEY lipsește din .env (cheia se ia din Google AI Studio).");
  const models = [model, ...fallbackModels.filter((m) => m !== model)];
  let firstError: AiUnavailableError | undefined;
  for (let i = 0; i < models.length; i++) {
    try {
      return await callModel(models[i], messages, tools, i < models.length - 1);
    } catch (e) {
      if (!(e instanceof GeminiBusyError)) throw e;
      firstError ??= e;
      console.warn(`[ai] ${models[i]} indisponibil (${e.message.slice(0, 80)}), încerc alt model`);
    }
  }
  throw firstError!;
}

/** One model. With `quick`, give up fast on overload so the next model can be tried. */
async function callModel(model: string, messages: OllamaMessage[], tools: ToolDef[], quick: boolean): Promise<OllamaMessage> {
  const { apiKey, baseUrl, thinkingLevel } = geminiConfig();

  const { system, contents } = toGemini(messages);
  let thinking = thinkingLevel;
  const body = () =>
    JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      ...(tools.length
        ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters })) }] }
        : {}),
      generationConfig: { temperature: 0.2, ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) },
    });

  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: body(),
        signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 45_000)),
      });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError" || /timeout/i.test((e as Error).message);
      if (timeout) throw new GeminiBusyError(`Gemini (${model}) nu a răspuns la timp.`);
      throw new AiUnavailableError(`Gemini nu răspunde (internet?): ${(e as Error).message}`);
    }
    if (res.ok) return fromGemini(await res.json());

    const text = await res.text().catch(() => "");
    // older models don't know thinkingLevel: retry once without it
    if (res.status === 400 && thinking && /thinking/i.test(text)) {
      thinking = "";
      continue;
    }
    // free tier: ~15 requests/minute. Wait and retry a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < (quick ? 1 : 3)) {
      await sleep([4000, 10_000, 20_000][attempt]);
      continue;
    }
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(text))
      throw new AiUnavailableError(`Cheia Gemini nu e acceptată (${res.status}). Verifică GEMINI_API_KEY. ${text.slice(0, 300)}`);
    if (res.status === 404) throw new GeminiBusyError(`Modelul „${model}” nu există pentru această cheie. Schimbă GEMINI_MODEL (ex. gemini-3.8-flash). ${text.slice(0, 200)}`);
    if (res.status === 429) throw new GeminiBusyError(`Limita gratuită Gemini (${model}) a fost atinsă. Mai încearcă peste un minut. ${text.slice(0, 200)}`);
    if (res.status >= 500) throw new GeminiBusyError(`Gemini (${model}) e supraîncărcat (${res.status}). Mai încearcă puțin mai târziu.`);
    throw new AiUnavailableError(`Gemini a răspuns cu ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new GeminiBusyError(`Gemini (${model}) nu a răspuns după mai multe încercări.`);
}

export async function geminiHealth(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { apiKey, baseUrl, model } = geminiConfig();
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY lipsește" };
  try {
    const r = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}` };
    return { ok: true, models: [model] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
