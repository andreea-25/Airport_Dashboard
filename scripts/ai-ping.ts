/**
 * Gemini speed check with the real admin prompt and tools.
 *   npx tsx scripts/ai-ping.ts
 * Compares how the tools are sent, to find what makes Gemini slow.
 */
process.loadEnvFile?.(".env");

const key = process.env.GEMINI_API_KEY?.trim() ?? "";
const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const base = "https://generativelanguage.googleapis.com/v1beta";

type Json = Record<string, unknown>;
/** JSON Schema → Gemini's own (OpenAPI-style) schema: same keys, no empty objects. */
function toGeminiSchema(s: Json): Json | undefined {
  const out: Json = {};
  for (const k of ["type", "description", "enum"]) if (s[k] !== undefined) out[k] = s[k];
  if (s.items) out.items = toGeminiSchema(s.items as Json);
  if (s.properties) {
    const props = Object.entries(s.properties as Record<string, Json>);
    if (!props.length) return undefined;
    out.properties = Object.fromEntries(props.map(([k, v]) => [k, toGeminiSchema(v)]));
    if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  }
  return out;
}

async function main() {
  const { toolsFor } = await import("../src/lib/ai/tools");
  const { systemPrompt } = await import("../src/lib/ai/agent");
  const defs = toolsFor("ADMIN_SIM").defs;
  const system = { parts: [{ text: systemPrompt("ADMIN_SIM", "Administrator") }] };
  const contents = [{ role: "user", parts: [{ text: "Analizează scenariul curent și propune 1–3 îmbunătățiri concrete." }] }];
  const nativeTools = [
    {
      functionDeclarations: defs.map((t) => {
        const p = toGeminiSchema(t.function.parameters as Json);
        return { name: t.function.name, description: t.function.description, ...(p ? { parameters: p } : {}) };
      }),
    },
  ];
  const cfg = { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } };

  // which Flash models does this key have?
  const list = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": key } }).then((r) => r.json()).catch(() => ({}));
  const flash: string[] = (list.models ?? [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) => /flash/i.test(m.name) && m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  console.log(`Modele Flash disponibile: ${flash.join(", ") || "(niciunul?)"}\n`);
  const lite = flash.filter((m) => /lite/i.test(m) && !/preview|exp/i.test(m)).slice(0, 2);
  const toTest = [...lite, model];

  const variants: { label: string; model: string; body: Json }[] = toTest.flatMap((m) => [
    { label: "mesaj scurt", model: m, body: { contents: [{ role: "user", parts: [{ text: "Spune salut." }] }] } },
    { label: "cu unelte, gândire low", model: m, body: { systemInstruction: system, contents, tools: nativeTools, generationConfig: cfg } },
    { label: "cu unelte, fără setare de gândire", model: m, body: { systemInstruction: system, contents, tools: nativeTools, generationConfig: { temperature: 0.2 } } },
  ]);

  for (const v of variants) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/models/${v.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(v.body),
        signal: AbortSignal.timeout(60_000),
      });
      const ms = Date.now() - t0;
      const j = await r.json().catch(() => ({}));
      const parts = j.candidates?.[0]?.content?.parts ?? [];
      const what = parts.map((p: { functionCall?: { name: string }; thought?: boolean }) => (p.functionCall ? `unealtă:${p.functionCall.name}` : p.thought ? "gând" : "text")).join(", ");
      console.log(`[${v.model}] ${v.label}: HTTP ${r.status} în ${(ms / 1000).toFixed(1)} s · ${what || j.error?.message || "—"} · gândire ${j.usageMetadata?.thoughtsTokenCount ?? 0}`);
    } catch (e) {
      console.log(`[${v.model}] ${v.label}: EROARE după ${((Date.now() - t0) / 1000).toFixed(1)} s · ${(e as Error).message}`);
    }
  }
}
main();
