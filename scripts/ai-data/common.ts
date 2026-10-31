/* Shared helpers for the AI dataset generator and the evaluation runner. */
import "dotenv/config";
import { prisma } from "../../src/lib/db";
import type { Session } from "../../src/lib/auth";
import { toolsFor } from "../../src/lib/ai/tools";
import type { ToolDef } from "../../src/lib/ai/ollama";
import { addDaysStr, localDateStr, periodRange } from "../../src/lib/time";

export type Mode = "EMPLOYEE" | "ADMIN_SIM";
export type ToolCallRec = { name: string; args: Record<string, unknown> };

/** One chat message in the training format (OpenAI / Hugging Face style, understood by Qwen/Llama chat templates). */
export type TrainMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { type: "function"; function: { name: string; arguments: Record<string, unknown> } }[] }
  | { role: "tool"; name: string; content: string };

/** What a correct answer must look like — checked by the evaluation runner. */
export type Expect = {
  /** tools that must be called (any order) */
  tools?: string[];
  /** tools that must NOT be called */
  forbidTools?: string[];
  /** the assistant must answer without calling any tool */
  noTools?: boolean;
  /** argument checks */
  args?: (
    | { tool: string; key: string; equals: string }
    | { tool: string; key: string; includes: string }
    | { tool: string; dateRangeCovers: { from: string; to: string } }
  )[];
  /** at least one of these strings must appear in the final answer (case/diacritics-insensitive) */
  replyAnyOf?: string[];
  /** admin: a suggestion must be saved and raise the score */
  suggestionImproves?: boolean;
  /** admin: this person must not appear in the saved changes */
  notMoved?: string;
};

export type EvalCase = {
  id: string;
  category: string;
  mode: Mode;
  /** login of the employee asking (employee mode); admin cases use the admin account */
  userEmail?: string;
  prompt: string;
  expect: Expect;
  /** date tokens like {{saturday}} in expect are resolved at evaluation time (generated cases use real dates) */
  note?: string;
};

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Seeded random generator so the datasets are reproducible. */
export function rng(seed: number) {
  let x = seed >>> 0;
  const next = () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
  return {
    next,
    pick<T>(a: readonly T[]): T {
      return a[Math.floor(next() * a.length)];
    },
    shuffle<T>(a: T[]): T[] {
      const b = [...a];
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      return b;
    },
  };
}

export async function sessionFor(email: string): Promise<Session | null> {
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) return null;
  return { userId: u.id, role: u.role, employeeId: u.employeeId, email: u.email };
}

/** Relative dates used in questions ("weekendul ăsta", "mâine"...), computed from a given "today". */
export function relDates(today: string) {
  const we = periodRange("weekend", today);
  const nw = periodRange("saptamana_viitoare", today);
  return {
    today,
    tomorrow: addDaysStr(today, 1),
    saturday: we.from,
    sunday: we.to,
    nextMonday: nw.from,
    nextSunday: nw.to,
    in2weeks: addDaysStr(today, 13),
  };
}
export const todayStr = () => localDateStr(new Date());
export const ddmm = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;

/** Replace {{token}} placeholders in an eval case with real dates. */
export function resolveTokens<T>(obj: T, today = todayStr()): T {
  const r = relDates(today) as Record<string, string>;
  return JSON.parse(JSON.stringify(obj).replace(/\{\{(\w+)\}\}/g, (_, k) => r[k] ?? `{{${k}}}`));
}

/** Execute a tool exactly like the agent would, returning the string the model sees and any metadata. */
export async function execTool(mode: Mode, name: string, args: Record<string, unknown>, ctx: { session: Session; scenarioId?: string | null; conversationId: string }) {
  const { exec } = toolsFor(mode);
  const fn = exec[name];
  if (!fn) throw new Error(`Unknown tool ${name}`);
  const r = await fn(args, ctx);
  const content = JSON.stringify(r.result);
  // find_improvements candidates must be stored for propose_changes(candidate_ids) to find them
  await prisma.aiMessage.create({ data: { conversationId: ctx.conversationId, role: "tool", content, toolCalls: { name, args, ok: true, ...(r.meta ? { meta: r.meta } : {}) } as object } });
  return { content, result: r.result as Record<string, unknown>, pending: r.pendingRequest };
}

export function toolDefs(mode: Mode): ToolDef[] {
  return toolsFor(mode).defs;
}

export const TEMP_PREFIX = "[ai-data]";

/** Scenarios created by these scripts are temporary (marked in `notes`) and removed at the end. */
export async function cleanupTemp(prefix = TEMP_PREFIX) {
  const sc = await prisma.scenario.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } });
  await prisma.aiConversation.deleteMany({ where: { scenarioId: { in: sc.map((s) => s.id) } } });
  await prisma.scenario.deleteMany({ where: { id: { in: sc.map((s) => s.id) } } });
}

export { prisma };
