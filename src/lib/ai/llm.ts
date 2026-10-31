import { AiUnavailableError, ollamaChat, ollamaConfig, ollamaHealth, type OllamaMessage, type ToolDef } from "./ollama";
import { geminiChat, geminiConfig, geminiHealth } from "./gemini";

/**
 * Picks the AI provider from .env:
 *   AI_PROVIDER="ollama" (default, local) | "gemini" (Google, needs GEMINI_API_KEY)
 *   AI_FALLBACK="ollama" — if Gemini fails (no internet, quota), try local Ollama. Default: on when AI_PROVIDER=gemini.
 */
export type Provider = "ollama" | "gemini";

export function llmConfig() {
  const provider: Provider = process.env.AI_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "ollama";
  const fallback = provider === "gemini" && (process.env.AI_FALLBACK?.trim().toLowerCase() ?? "ollama") === "ollama";
  const model = provider === "gemini" ? geminiConfig().model : ollamaConfig().model;
  // rough size of what we may send (characters; ~3 chars per token for Romanian)
  const maxPromptChars = provider === "gemini" ? 120_000 : Math.max(8000, ollamaConfig().numCtx * 3 - 4000);
  return { provider, fallback, model, maxPromptChars };
}

export async function llmChat(messages: OllamaMessage[], tools: ToolDef[]): Promise<{ message: OllamaMessage; provider: Provider; model: string }> {
  const cfg = llmConfig();
  if (cfg.provider === "ollama") return { message: await ollamaChat(messages, tools), provider: "ollama", model: cfg.model };
  try {
    return { message: await geminiChat(messages, tools), provider: "gemini", model: cfg.model };
  } catch (e) {
    if (!cfg.fallback || !(e instanceof AiUnavailableError)) throw e;
    console.warn("[ai] Gemini indisponibil, încerc Ollama:", e.message);
    try {
      return { message: await ollamaChat(messages, tools), provider: "ollama", model: ollamaConfig().model };
    } catch {
      throw e; // report the Gemini problem, it's the one that matters
    }
  }
}

export async function llmHealth() {
  const cfg = llmConfig();
  const main = cfg.provider === "gemini" ? await geminiHealth() : await ollamaHealth();
  return { provider: cfg.provider, model: cfg.model, ...main, ...(cfg.fallback ? { fallback: { provider: "ollama", ...(await ollamaHealth()) } } : {}) };
}
