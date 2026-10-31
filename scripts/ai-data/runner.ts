/* Runs an intent on real data and records the conversation in training format. Used by generate.ts and eval.ts. */
import type { Session } from "../../src/lib/auth";
import { describeUser, systemPrompt } from "../../src/lib/ai/agent";
import { findImprovements } from "../../src/lib/sim/optimize";
import { createScenarioFromReal, applyChanges, loadScenarioData } from "../../src/lib/sim/scenario";
import { localToUtc } from "../../src/lib/time";
import { execTool, prisma, rng, type Mode, type TrainMessage } from "./common";
import type { Intent, IntentCtx, IntentOut } from "./intents";

const LEVEL_ORDER = ["Agent I", "Agent II", "Senior", "Team Lead", "Supervizor"];
const CERTS = ["AVSEC", "DGR (mărfuri periculoase)", "prim ajutor", "asistență PRM", "degivrare", "pushback", "conducere pe platformă"];

export type Subject =
  | { mode: "EMPLOYEE"; session: Session }
  | { mode: "ADMIN_SIM"; session: Session; scenarioId: string };

/** Facts the intents use to build realistic questions (names, departments...). */
export async function factsFor(subject: Subject, seed: number): Promise<IntentCtx["facts"]> {
  const r = rng(seed);
  if (subject.mode === "EMPLOYEE") {
    const me = await prisma.employee.findUniqueOrThrow({ where: { id: subject.session.employeeId! }, include: { level: true, department: true } });
    const i = LEVEL_ORDER.indexOf(me.level.name);
    const others = await prisma.employee.findMany({ where: { id: { not: me.id }, active: true }, select: { firstName: true, lastName: true }, take: 60 });
    return {
      myName: `${me.firstName} ${me.lastName}`,
      myDepartmentCode: me.department.code,
      nextLevel: LEVEL_ORDER[i + 1] ?? null,
      higherLevel: LEVEL_ORDER[i + 2] ?? LEVEL_ORDER[i + 1] ?? null,
      colleagues: r.shuffle(others).slice(0, 8).map((o) => (r.next() < 0.5 ? `${o.firstName} ${o.lastName}` : o.lastName)),
      certNames: CERTS,
    };
  }
  const data = await loadScenarioData(subject.scenarioId);
  const { candidates } = findImprovements(data, { limit: 10 });
  const inCands = [...new Set(candidates.flatMap((c) => c.employeeIds))];
  const pool = [...inCands, ...r.shuffle(Object.keys(data.employees)).slice(0, 6)];
  return {
    departments: Object.values(data.departments).map((d) => ({ code: d.code, name: d.name })),
    employeesInScenario: pool
      .map((id) => data.employees[id])
      .filter(Boolean)
      .map((e) => ({ name: e.name, code: data.departments[e.departmentId]?.code ?? "SEC" })),
  };
}

/**
 * Run one intent. `record=true` keeps the full message list (training example);
 * otherwise only the prompt + expectations are returned (evaluation).
 */
export async function runIntent(intent: Intent, subject: Subject, opts: { seed: number; today: string; at: Date; facts: IntentCtx["facts"] }) {
  const conv = await prisma.aiConversation.create({
    data: { userId: subject.session.userId, mode: subject.mode, scenarioId: subject.mode === "ADMIN_SIM" ? subject.scenarioId : null },
  });
  const messages: TrainMessage[] = [];
  const ctx: IntentCtx = {
    mode: subject.mode,
    today: opts.today,
    r: rng(opts.seed),
    facts: opts.facts,
    call: async (name, args) => {
      messages.push({ role: "assistant", content: "", tool_calls: [{ type: "function", function: { name, arguments: args } }] });
      const { content, result } = await execTool(subject.mode, name, args, {
        session: subject.session,
        conversationId: conv.id,
        scenarioId: subject.mode === "ADMIN_SIM" ? subject.scenarioId : null,
      });
      messages.push({ role: "tool", name, content });
      return result;
    },
  };
  let out: IntentOut = null;
  try {
    out = await intent.run(ctx);
  } finally {
    await prisma.aiConversation.delete({ where: { id: conv.id } });
  }
  if (!out) return null;
  const who = await describeUser(subject.session);
  const full: TrainMessage[] = [
    { role: "system", content: systemPrompt(subject.mode as Mode, who, opts.at) },
    { role: "user", content: out.prompt },
    ...messages,
    { role: "assistant", content: out.answer },
  ];
  return { ...out, messages: full };
}

/** Temporary scenarios with different situations, so admin examples are varied. */
export async function makeTempScenarios(adminUserId: string, prefix: string, variants: ("plain" | "sick" | "traffic" | "expire" | "12h")[], weekOffsets: number[]) {
  const ids: string[] = [];
  const now = new Date();
  const monday = (() => {
    const d = new Date(now);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  })();
  const r = rng(77);
  for (const off of weekOffsets) {
    for (const v of variants) {
      const start = new Date(`${monday}T12:00:00Z`);
      start.setUTCDate(start.getUTCDate() + off * 7);
      const s = start.toISOString().slice(0, 10);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      const label = { plain: "Program de bază", sick: "Concedii medicale", traffic: "Trafic crescut dimineața", expire: "AVSEC expirat", "12h": "Ture de 12h la handling" }[v];
      const sc = await createScenarioFromReal({
        name: `${label} — săptămâna ${s.slice(8)}.${s.slice(5, 7)}`,
        notes: prefix,
        createdById: adminUserId,
        periodStart: localToUtc(s, "00:00"),
        periodEnd: localToUtc(end.toISOString().slice(0, 10), "00:00"),
      });
      const data = await loadScenarioData(sc.id);
      if (!data.shifts.length) {
        await prisma.scenario.delete({ where: { id: sc.id } });
        continue;
      }
      const depts = Object.values(data.departments);
      const skills = Object.values(data.skills);
      if (v === "sick") {
        const day = data.shifts[Math.floor(r.next() * data.shifts.length)];
        const people = r.shuffle(day.assignments.map((a) => a.employeeId)).slice(0, 3);
        const date = day.startAt.toISOString().slice(0, 10);
        if (people.length) await applyChanges(sc.id, people.map((employeeId) => ({ type: "ADD_ABSENCE", employeeId, date })));
      } else if (v === "traffic") {
        await applyChanges(sc.id, [{ type: "ADJUST_STAFFING", startHour: 5, endHour: 9, factor: 1.3 }]);
      } else if (v === "expire") {
        const avsec = skills.find((x) => x.code === "AVSEC");
        if (avsec) await applyChanges(sc.id, [{ type: "EXPIRE_SKILL", skillId: avsec.id }]);
      } else if (v === "12h") {
        const rmp = depts.find((d) => d.code === "RMP");
        if (rmp) {
          await applyChanges(sc.id, [{ type: "CHANGE_SHIFT_HOURS", departmentId: rmp.id, fromStart: "06:00", startTime: "06:00", endTime: "18:00" }]).catch(() => null);
          await applyChanges(sc.id, [{ type: "CHANGE_SHIFT_HOURS", departmentId: rmp.id, fromStart: "14:00", startTime: "18:00", endTime: "06:00" }]).catch(() => null);
        }
      }
      ids.push(sc.id);
    }
  }
  return ids;
}
