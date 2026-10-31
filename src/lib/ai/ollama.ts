export type OllamaToolCall = {
  /** set by Gemini (OpenAI-compatible API); Ollama ignores it */
  id?: string;
  function: { name: string; arguments: Record<string, unknown> | string };
  /** Gemini "thought signature" — must be sent back unchanged with the call */
  extra_content?: unknown;
};
export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};
export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] } };
};

export class AiUnavailableError extends Error {}

export function ollamaConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL || "qwen3:8b",
    numCtx: Number(process.env.OLLAMA_NUM_CTX || 8192),
  };
}

/** One non-streaming chat call to Ollama with tool definitions. */
export async function ollamaChat(messages: OllamaMessage[], tools: ToolDef[]): Promise<OllamaMessage> {
  const { baseUrl, model, numCtx } = ollamaConfig();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools,
        stream: false,
        think: false, // qwen3: skip the reasoning trace, we only want the answer / tool calls
        options: { num_ctx: numCtx, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS || 300_000)),
    });
  } catch (e) {
    throw new AiUnavailableError(`Ollama nu răspunde la ${baseUrl}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // older Ollama versions reject the "think" flag; retry once without it
    if (res.status === 400 && text.includes("think")) {
      const r2 = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, tools, stream: false, options: { num_ctx: numCtx, temperature: 0.2 } }),
      });
      if (r2.ok) return cleanup((await r2.json()).message);
    }
    throw new AiUnavailableError(`Ollama a răspuns cu ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return cleanup(json.message as OllamaMessage);
}

function cleanup(m: OllamaMessage): OllamaMessage {
  return { ...m, content: (m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() };
}

export async function ollamaHealth(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { baseUrl } = ollamaConfig();
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return { ok: true, models: (j.models ?? []).map((m: { name: string }) => m.name) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
