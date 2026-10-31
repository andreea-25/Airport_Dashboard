/*
 * Generates the AI datasets from the real (demo) database:
 *   data/ai/train.jsonl  — complete conversations for fine-tuning (system, user, tool calls, tool results, answer)
 *   data/ai/eval.jsonl   — held-out test cases (other people, other scenario), regenerated fresh at evaluation time
 *   data/ai/tools.json   — tool definitions (needed by the training notebook)
 *
 * Usage:  npm run ai:generate                (default 600 training examples, 60 test cases)
 *         npm run ai:generate -- --train 1500 --eval 80 --seed 7
 * The database must be running (npm run local / local:db in another terminal). Ollama is NOT needed.
 */
import "dotenv/config"; // must be first: the database client reads DATABASE_URL when it is imported
import { mkdirSync, writeFileSync } from "node:fs";
import { addDaysStr, localToUtc, mondayOf } from "../../src/lib/time";
import type { Session } from "../../src/lib/auth";
import { INTENTS } from "./intents";
import { cleanupTemp, prisma, rng, sessionFor, TEMP_PREFIX, todayStr, toolDefs } from "./common";
import { factsFor, makeTempScenarios, runIntent, type Subject } from "./runner";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const N_TRAIN = arg("train", 600);
const N_EVAL = arg("eval", 60);
const SEED = arg("seed", 42);
const ADMIN_SHARE = 0.3;

/** People kept OUT of training so the test measures generalisation, not memorisation. */
const EVAL_USERS = ["angajat.securitate@aeroport.demo", "angajat.handling@aeroport.demo", "angajat.checkin@aeroport.demo", "angajat.prm@aeroport.demo"];

async function main() {
  const r = rng(SEED);
  const t0 = Date.now();
  await cleanupTemp();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Nu există un cont de admin. Rulează seed-ul (npm run db:seed).");
  const adminSession: Session = { userId: admin.id, role: admin.role, employeeId: null, email: admin.email };

  const users = await prisma.user.findMany({ where: { role: "EMPLOYEE", employee: { active: true } }, select: { email: true } });
  const evalExtra = r.shuffle(users.map((u) => u.email).filter((e) => !EVAL_USERS.includes(e))).slice(0, 6);
  const evalUsers = new Set([...EVAL_USERS, ...evalExtra]);
  const trainUsers = users.map((u) => u.email).filter((e) => !evalUsers.has(e));
  console.log(`Angajați: ${trainUsers.length} pentru antrenare, ${evalUsers.size} păstrați pentru test.`);

  console.log("Creez scenarii temporare variate pentru exemplele de admin…");
  const scenarios = await makeTempScenarios(admin.id, TEMP_PREFIX, ["plain", "sick", "traffic", "expire", "12h"], [0, 1]);
  console.log(`  ${scenarios.length} scenarii temporare`);
  const scenarioFacts = new Map<string, Awaited<ReturnType<typeof factsFor>>>();
  for (const id of scenarios) scenarioFacts.set(id, await factsFor({ mode: "ADMIN_SIM", session: adminSession, scenarioId: id }, SEED));

  const empIntents = INTENTS.filter((i) => i.mode === "EMPLOYEE");
  const admIntents = INTENTS.filter((i) => i.mode === "ADMIN_SIM");
  const monday = mondayOf(new Date());

  // ---------------------------------------------------------------- training set
  mkdirSync("data/ai", { recursive: true });
  const lines: string[] = [];
  const perIntent: Record<string, number> = {};
  let attempts = 0;
  while (lines.length < N_TRAIN && attempts < N_TRAIN * 3) {
    attempts++;
    const seed = Math.floor(r.next() * 1e9);
    const admin_ = r.next() < ADMIN_SHARE && scenarios.length > 0;
    const intent = admin_ ? r.pick(admIntents) : r.pick(empIntents);
    // a simulated "today" inside the seeded period, so the model learns relative dates, not one fixed date
    const today = addDaysStr(monday, Math.floor(r.next() * 14) - 10);
    const at = localToUtc(today, `${String(8 + Math.floor(r.next() * 12)).padStart(2, "0")}:${r.pick(["05", "20", "35", "50"])}`);
    let subject: Subject;
    let facts;
    if (admin_) {
      const sid = r.pick(scenarios);
      subject = { mode: "ADMIN_SIM", session: adminSession, scenarioId: sid };
      facts = scenarioFacts.get(sid)!;
    } else {
      const s = await sessionFor(r.pick(trainUsers));
      if (!s) continue;
      subject = { mode: "EMPLOYEE", session: s };
      facts = await factsFor(subject, seed);
    }
    try {
      const ex = await runIntent(intent, subject, { seed, today, at, facts });
      if (!ex) continue;
      lines.push(JSON.stringify({ id: `t${lines.length + 1}`, intent: intent.id, category: intent.category, mode: intent.mode, messages: ex.messages, tools: toolDefs(intent.mode) }));
      perIntent[intent.id] = (perIntent[intent.id] ?? 0) + 1;
      if (lines.length % 50 === 0) console.log(`  ${lines.length}/${N_TRAIN} exemple…`);
    } catch (e) {
      console.warn(`  (sărit ${intent.id}: ${(e as Error).message})`);
    }
  }
  writeFileSync("data/ai/train.jsonl", lines.join("\n") + "\n");

  // ---------------------------------------------------------------- test set (definitions only; built fresh at evaluation time)
  const evalLines: string[] = [];
  const evalList = [...evalUsers];
  for (let i = 0; i < N_EVAL; i++) {
    const admin_ = i % 3 === 2;
    const intent = admin_ ? admIntents[i % admIntents.length] : empIntents[i % empIntents.length];
    evalLines.push(JSON.stringify({ kind: "generated", id: `g${i + 1}`, intent: intent.id, mode: intent.mode, userEmail: admin_ ? undefined : evalList[i % evalList.length], seed: 1000 + i }));
  }
  writeFileSync("data/ai/eval.jsonl", evalLines.join("\n") + "\n");
  writeFileSync("data/ai/tools.json", JSON.stringify({ EMPLOYEE: toolDefs("EMPLOYEE"), ADMIN_SIM: toolDefs("ADMIN_SIM") }, null, 2));

  await cleanupTemp();
  console.log(`\n✓ ${lines.length} exemple de antrenare → data/ai/train.jsonl`);
  console.log(`✓ ${evalLines.length} cazuri de test → data/ai/eval.jsonl (+ cazurile scrise de mână din data/ai/eval-manual.jsonl)`);
  console.log("  Pe intenții:", Object.entries(perIntent).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(`  Durată: ${Math.round((Date.now() - t0) / 1000)} s`);
  void todayStr;
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanupTemp().catch(() => null);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
