/*
 * Evaluates the AI assistant on the test set and prints a report card.
 *   npm run ai:eval                          (all test cases, model from .env)
 *   npm run ai:eval -- --model qwen2.5:7b    (another Ollama model)
 *   npm run ai:eval -- --limit 10            (quick check)
 *   npm run ai:eval -- --only manual         (only the hand-written cases; or: generated)
 *   npm run ai:eval -- --mode EMPLOYEE       (only employee cases; or ADMIN_SIM)
 * Needs: the database running (npm run local / local:db) and Ollama running.
 * Writes: data/ai/reports/<date>-<model>.json and .md
 */
import "dotenv/config"; // must be first: the database client reads DATABASE_URL when it is imported
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runAgent } from "../../src/lib/ai/agent";
import { ollamaConfig, ollamaHealth } from "../../src/lib/ai/ollama";
import { addDaysStr, localToUtc, periodRange, SHIFT_PERIODS, type ShiftPeriod } from "../../src/lib/time";
import type { Session } from "../../src/lib/auth";
import { INTENTS } from "./intents";
import { cleanupTemp, norm, prisma, resolveTokens, sessionFor, todayStr, type EvalCase, type Expect } from "./common";
import { factsFor, makeTempScenarios, runIntent, type Subject } from "./runner";

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const EVAL_PREFIX = "[ai-eval]";

type Rec = { name: string; args: Record<string, unknown>; ok: boolean };
type Check = { name: string; pass: boolean; detail?: string };

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("//")).map((l) => JSON.parse(l) as T);
}

function looksRomanian(text: string) {
  const t = ` ${text.toLowerCase().replace(/[.,!?;:]/g, " ")} `;
  const ro = [" și ", " si ", " în ", " in ", " că ", " ai ", " este ", " nu ", " pentru ", " cu ", " de ", " la ", " tale ", " tău ", " tura ", " îți ", " vă ", " pot "].filter((w) => t.includes(w)).length + (/[ăâîșțşţ]/.test(t) ? 2 : 0);
  const en = [" the ", " you ", " your ", " is ", " are ", " and ", " with ", " have "].filter((w) => t.includes(w)).length;
  // short answers ("Liderul turei tale este Elena Dobre.") have few function words — be lenient
  return ro > en && (ro >= 2 || text.length < 80);
}

/** A key fact counts as present if it appears literally, or if every longer word of it appears (stem match: "coordonare echipă" ≈ "coordonarea echipei"). */
function hasFact(reply: string, fact: string) {
  const r = norm(reply);
  const f = norm(fact);
  if (!f) return false;
  if (r.includes(f)) return true;
  const words = f.split(/[^a-z0-9:]+/).filter((w) => w.length >= 4);
  return words.length > 0 && words.every((w) => r.includes(w.slice(0, 5)));
}

function check(expect: Expect, calls: Rec[], reply: string, extra: { suggestionDelta: number | null; movedNames: string[] }): Check[] {
  const out: Check[] = [];
  const names = calls.map((c) => c.name);
  if (expect.noTools) out.push({ name: "fără unelte", pass: calls.length === 0, detail: names.join(", ") || undefined });
  for (const t of expect.tools ?? []) out.push({ name: `apelează ${t}`, pass: names.includes(t), detail: names.join(", ") || "nicio unealtă" });
  for (const t of expect.forbidTools ?? []) out.push({ name: `nu apelează ${t}`, pass: !names.includes(t) });
  for (const a of expect.args ?? []) {
    const c = calls.filter((x) => x.name === a.tool);
    const label = "dateRangeCovers" in a ? `interval corect ${a.tool}` : "equals" in a ? `${a.tool}.${a.key} = ${a.equals}` : `${a.tool}.${a.key} conține „${a.includes}”`;
    if (!c.length) {
      out.push({ name: label, pass: false, detail: "unealta nu a fost apelată" });
      continue;
    }
    if ("dateRangeCovers" in a) {
      // the same rules as the tool: `period` wins, otherwise from/to (default: next 14 days)
      const range = (x: Rec) => {
        if (typeof x.args.period === "string" && (SHIFT_PERIODS as readonly string[]).includes(x.args.period)) return periodRange(x.args.period as ShiftPeriod);
        const from = typeof x.args.from === "string" ? x.args.from : todayStr();
        const to = typeof x.args.to === "string" ? x.args.to : addDaysStr(from, 13);
        return { from, to };
      };
      const okAny = c.some((x) => {
        const g = range(x);
        return g.from <= a.dateRangeCovers.from && g.to >= a.dateRangeCovers.to;
      });
      out.push({ name: `interval corect ${a.tool}`, pass: okAny, detail: `așteptat ${a.dateRangeCovers.from}…${a.dateRangeCovers.to}, primit ${c.map((x) => { const g = range(x); return `${g.from}…${g.to}${x.args.period ? ` (period=${x.args.period})` : ""}`; }).join("; ")}` });
    } else if ("equals" in a) {
      const okAny = c.some((x) => norm(String(x.args[a.key] ?? "")) === norm(a.equals));
      out.push({ name: `${a.tool}.${a.key} = ${a.equals}`, pass: okAny, detail: c.map((x) => JSON.stringify(x.args[a.key])).join("; ") });
    } else {
      const okAny = c.some((x) => norm(JSON.stringify(x.args[a.key] ?? "")).includes(norm(a.includes)));
      out.push({ name: `${a.tool}.${a.key} conține „${a.includes}”`, pass: okAny, detail: c.map((x) => JSON.stringify(x.args[a.key])).join("; ") });
    }
  }
  out.push({ name: "uneltele au mers fără erori", pass: calls.every((c) => c.ok), detail: calls.filter((c) => !c.ok).map((c) => c.name).join(", ") || undefined });
  out.push({ name: "răspunde în română", pass: looksRomanian(reply) });
  if (expect.replyAnyOf?.length) {
    out.push({ name: "răspunsul conține datele cheie", pass: expect.replyAnyOf.some((x) => x && hasFact(reply, x)), detail: `una din: ${expect.replyAnyOf.slice(0, 4).join(" | ")}` });
  }
  if (expect.suggestionImproves) out.push({ name: "sugestia salvată crește scorul", pass: (extra.suggestionDelta ?? -1) > 0, detail: extra.suggestionDelta === null ? "nicio sugestie salvată" : `Δscor ${extra.suggestionDelta.toFixed(2)}` });
  if (expect.notMoved) out.push({ name: `nu mută pe ${expect.notMoved}`, pass: !extra.movedNames.some((n) => norm(n).includes(norm(expect.notMoved!))), detail: extra.movedNames.join(", ") || undefined });
  return out;
}

async function main() {
  const modelArg = flag("model");
  if (modelArg) process.env.OLLAMA_MODEL = modelArg;
  const model = ollamaConfig().model;
  const health = await ollamaHealth();
  if (!health.ok) throw new Error(`Ollama nu răspunde la ${ollamaConfig().baseUrl}. Pornește Ollama și încearcă din nou.`);
  if (!health.models?.some((m) => m === model || m === `${model}:latest`)) throw new Error(`Modelul ${model} nu e instalat în Ollama. Rulează: ollama pull ${model}`);

  const only = flag("only");
  const modeFilter = flag("mode");
  const limit = Number(flag("limit") ?? 0);
  type GenCase = { kind: "generated"; id: string; intent: string; mode: string; userEmail?: string; seed: number };
  let cases: (EvalCase | GenCase)[] = [
    ...(only === "manual" ? [] : readJsonl<GenCase>("data/ai/eval.jsonl")),
    ...(only === "generated" ? [] : readJsonl<EvalCase>("data/ai/eval-manual.jsonl").map((c) => resolveTokens(c))),
  ];
  if (modeFilter) cases = cases.filter((c) => c.mode === modeFilter);
  if (limit) cases = cases.slice(0, limit);
  if (!cases.length) throw new Error("Nu am găsit cazuri de test. Rulează întâi: npm run ai:generate");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const adminSession: Session = { userId: admin.id, role: admin.role, employeeId: null, email: admin.email };
  await cleanupTemp(EVAL_PREFIX);
  const needsAdmin = cases.some((c) => c.mode === "ADMIN_SIM");
  const [scenarioId] = needsAdmin ? await makeTempScenarios(admin.id, EVAL_PREFIX, ["plain"], [1]) : [];
  const adminFacts = scenarioId ? await factsFor({ mode: "ADMIN_SIM", session: adminSession, scenarioId }, 5) : undefined;

  console.log(`Model: ${model} · ${cases.length} cazuri de test\n`);
  const today = todayStr();
  const results: { id: string; category: string; mode: string; prompt: string; pass: boolean; checks: Check[]; calls: Rec[]; reply: string; ms: number }[] = [];

  for (const c of cases) {
    // ---- build the case (generated cases are rebuilt fresh, so dates and data are always current)
    let prompt: string;
    let expect: Expect;
    let category: string;
    let session = adminSession;
    if ("kind" in c) {
      const intent = INTENTS.find((i) => i.id === c.intent);
      if (!intent) continue;
      category = intent.category;
      let subject: Subject;
      if (intent.mode === "ADMIN_SIM") subject = { mode: "ADMIN_SIM", session: adminSession, scenarioId };
      else {
        const s = c.userEmail ? await sessionFor(c.userEmail) : null;
        if (!s) {
          console.log(`- ${c.id}: utilizatorul ${c.userEmail} nu există, sar peste`);
          continue;
        }
        subject = { mode: "EMPLOYEE", session: s };
        session = s;
      }
      const facts = intent.mode === "ADMIN_SIM" ? adminFacts! : await factsFor(subject, c.seed);
      const ref = await runIntent(intent, subject, { seed: c.seed, today, at: new Date(), facts });
      // the reference run may have saved a suggestion: remove it so every case starts from the same state
      if (scenarioId) await prisma.scenarioSuggestion.deleteMany({ where: { scenarioId } });
      if (!ref) continue;
      prompt = ref.prompt;
      expect = ref.expect;
    } else {
      category = c.category;
      prompt = c.prompt;
      expect = c.expect;
      if (c.mode === "EMPLOYEE") {
        const s = await sessionFor(c.userEmail ?? "");
        if (!s) {
          console.log(`- ${c.id}: utilizatorul ${c.userEmail} nu există, sar peste`);
          continue;
        }
        session = s;
      }
    }

    // ---- ask the real model
    const conv = await prisma.aiConversation.create({ data: { userId: session.userId, mode: c.mode as "EMPLOYEE" | "ADMIN_SIM", scenarioId: c.mode === "ADMIN_SIM" ? scenarioId : null } });
    const t = Date.now();
    let reply = "";
    let calls: Rec[] = [];
    try {
      const r = await runAgent({ session, conversationId: conv.id, mode: c.mode as "EMPLOYEE" | "ADMIN_SIM", scenarioId: c.mode === "ADMIN_SIM" ? scenarioId : null, userMessage: prompt });
      reply = r.reply;
      calls = r.toolCalls.map((x) => ({ name: x.name, args: (x.args ?? {}) as Record<string, unknown>, ok: x.ok }));
    } catch (e) {
      reply = `EROARE: ${(e as Error).message}`;
    }
    const ms = Date.now() - t;

    // ---- admin: what did the saved suggestion do?
    let suggestionDelta: number | null = null;
    let movedNames: string[] = [];
    if (c.mode === "ADMIN_SIM" && scenarioId) {
      const sug = await prisma.scenarioSuggestion.findFirst({ where: { scenarioId }, orderBy: { createdAt: "desc" } });
      if (sug) {
        const imp = sug.estimatedImpact as { summary?: { score?: { a: number; b: number } }; messages?: string[] } | null;
        suggestionDelta = imp?.summary?.score ? imp.summary.score.b - imp.summary.score.a : null;
        const ids = new Set<string>();
        for (const ch of sug.changes as Record<string, unknown>[]) for (const k of ["employeeId"]) if (ch[k]) ids.add(String(ch[k]));
        const emps = await prisma.employee.findMany({ where: { id: { in: [...ids] } } });
        movedNames = [...emps.map((e) => `${e.firstName} ${e.lastName}`), ...(imp?.messages ?? [])];
      }
      await prisma.scenarioSuggestion.deleteMany({ where: { scenarioId } });
    }

    const checks = check(expect, calls, reply, { suggestionDelta, movedNames });
    const pass = checks.every((x) => x.pass);
    results.push({ id: c.id, category, mode: c.mode, prompt, pass, checks, calls, reply, ms });
    console.log(`${pass ? "✓" : "✗"} [${category}] ${prompt}  (${(ms / 1000).toFixed(1)}s)`);
    if (!pass) for (const x of checks.filter((k) => !k.pass)) console.log(`     ✗ ${x.name}${x.detail ? ` — ${x.detail}` : ""}`);
  }
  await cleanupTemp(EVAL_PREFIX);

  // ---- report card
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const passN = results.filter((r) => r.pass).length;
  const byCat: Record<string, { n: number; ok: number }> = {};
  for (const r of results) {
    const e = (byCat[r.category] ??= { n: 0, ok: 0 });
    e.n++;
    if (r.pass) e.ok++;
  }
  const byCheck: Record<string, { n: number; ok: number }> = {};
  for (const r of results)
    for (const k of r.checks) {
      const key = k.name.replace(/ (pe|lui) .*$/, "").replace(/„.*”/, "…").replace(/= .*/, "= …");
      const e = (byCheck[key] ??= { n: 0, ok: 0 });
      e.n++;
      if (k.pass) e.ok++;
    }
  const avgS = results.reduce((a, r) => a + r.ms, 0) / Math.max(1, results.length) / 1000;
  const lines = [
    `# Evaluare AI — ${model}`,
    ``,
    `Data: ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })} · ${results.length} cazuri · timp mediu ${avgS.toFixed(1)} s/caz`,
    ``,
    `## Rezultat: ${passN}/${results.length} cazuri trecute (${pct(passN, results.length)}%)`,
    ``,
    `| Categorie | Trecute |`,
    `|---|---|`,
    ...Object.entries(byCat).map(([k, v]) => `| ${k} | ${v.ok}/${v.n} (${pct(v.ok, v.n)}%) |`),
    ``,
    `| Verificare | Reușită |`,
    `|---|---|`,
    ...Object.entries(byCheck).map(([k, v]) => `| ${k} | ${v.ok}/${v.n} (${pct(v.ok, v.n)}%) |`),
    ``,
    `## Cazuri picate`,
    ...results
      .filter((r) => !r.pass)
      .map((r) => `- **${r.prompt}** (${r.category})\n  - unelte: ${r.calls.map((c) => `${c.name}${JSON.stringify(c.args)}`).join(" → ") || "niciuna"}\n  - ${r.checks.filter((k) => !k.pass).map((k) => `✗ ${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("\n  - ")}\n  - răspuns: ${r.reply.replace(/\n/g, " ").slice(0, 300)}`),
  ];
  mkdirSync("data/ai/reports", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base = `data/ai/reports/${stamp}-${model.replace(/[^a-z0-9.]+/gi, "_")}`;
  writeFileSync(`${base}.md`, lines.join("\n") + "\n");
  writeFileSync(`${base}.json`, JSON.stringify({ model, date: new Date().toISOString(), passed: passN, total: results.length, byCategory: byCat, byCheck, results }, null, 2));
  console.log(`\n${lines.slice(4, lines.indexOf("## Cazuri picate")).join("\n")}`);
  console.log(`\nRaport complet: ${base}.md`);
  void localToUtc;
}

main()
  .catch(async (e) => {
    console.error(`\n✖ ${(e as Error).message}`);
    await cleanupTemp(EVAL_PREFIX).catch(() => null);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
