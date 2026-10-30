"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { addDaysStr, localToUtc } from "@/lib/time";
import {
  applyChange,
  compareScenarios,
  createScenarioFromReal,
  duplicateScenario,
  previewChanges,
  skillGap,
  SimError,
  undoLastChange,
} from "@/lib/sim/scenario";
import type { Evaluation } from "@/lib/sim/types";
import type { Comparison } from "@/lib/sim/evaluate";

/** What the simulation UI needs (the full hourly coverage array stays on the server). */
export type SimView = {
  scenario: Omit<Evaluation, "coverage" | "hours"> & { topHours: Evaluation["hours"] };
  real: Pick<Evaluation, "summary" | "coverageByDept" | "coverageByHour">;
  diff: Comparison;
};

function slim(ev: Evaluation) {
  const { coverage: _c, hours, ...rest } = ev;
  void _c;
  return { ...rest, topHours: hours.slice(0, 15) };
}

export async function getSimView(scenarioId: string): Promise<SimView> {
  await assertAdmin();
  const r = await compareScenarios(scenarioId, "real");
  return {
    scenario: slim(r.a),
    real: { summary: r.b.summary, coverageByDept: r.b.coverageByDept, coverageByHour: r.b.coverageByHour },
    diff: r.diff,
  };
}

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const err = (e: unknown) => ({ ok: false as const, error: e instanceof SimError || e instanceof z.ZodError ? e.message : e instanceof Error ? e.message : "Eroare" });

const createSchema = z.object({
  name: z.string().trim().min(2),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(31),
  notes: z.string().optional(),
});

export async function createScenario(input: z.input<typeof createSchema>): Promise<R<{ id: string }>> {
  try {
    const s = await assertAdmin();
    const d = createSchema.parse(input);
    const sc = await createScenarioFromReal({
      name: d.name,
      createdById: s.userId,
      periodStart: localToUtc(d.start, "00:00"),
      periodEnd: localToUtc(addDaysStr(d.start, d.days), "00:00"),
      notes: d.notes,
    });
    await audit(s.userId, "Scenario", sc.id, "CREATE", d);
    revalidatePath("/admin/simulation");
    return { ok: true, id: sc.id };
  } catch (e) {
    return err(e);
  }
}

export async function duplicateScenarioAction(id: string): Promise<R<{ id: string }>> {
  try {
    const s = await assertAdmin();
    const c = await duplicateScenario(id, s.userId);
    await audit(s.userId, "Scenario", c.id, "DUPLICATE", { from: id });
    revalidatePath("/admin/simulation");
    return { ok: true, id: c.id };
  } catch (e) {
    return err(e);
  }
}

export async function deleteScenario(id: string): Promise<R> {
  try {
    const s = await assertAdmin();
    await prisma.scenario.delete({ where: { id } });
    await audit(s.userId, "Scenario", id, "DELETE");
    revalidatePath("/admin/simulation");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function applySimChange(scenarioId: string, change: unknown): Promise<R<{ message: string; view: SimView }>> {
  try {
    const s = await assertAdmin();
    const { message } = await applyChange(scenarioId, change);
    await audit(s.userId, "Scenario", scenarioId, "APPLY_CHANGE", change);
    return { ok: true, message, view: await getSimView(scenarioId) };
  } catch (e) {
    return err(e);
  }
}

export async function undoSimChange(scenarioId: string): Promise<R<{ view: SimView }>> {
  try {
    const s = await assertAdmin();
    const last = await undoLastChange(scenarioId);
    await audit(s.userId, "Scenario", scenarioId, "UNDO", { type: last.type });
    return { ok: true, view: await getSimView(scenarioId) };
  } catch (e) {
    return err(e);
  }
}

export async function previewSimChange(scenarioId: string, change: unknown): Promise<R<{ messages: string[]; impact: Comparison }>> {
  try {
    await assertAdmin();
    const r = await previewChanges(scenarioId, [change]);
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function skillGapAction(scenarioId: string, employeeId: string, target: { targetLevelId?: string; targetDepartmentId?: string }) {
  try {
    await assertAdmin();
    const ov = await prisma.scenarioEmployeeOverride.findUnique({ where: { scenarioId_employeeId: { scenarioId, employeeId } } });
    const gap = await skillGap(employeeId, target, ov ? { teamId: ov.teamId, departmentId: ov.departmentId, levelId: ov.levelId } : undefined);
    return { ok: true as const, gap };
  } catch (e) {
    return err(e);
  }
}

export async function getHistory(scenarioId: string) {
  await assertAdmin();
  const changes = await prisma.scenarioChange.findMany({ where: { scenarioId }, orderBy: { createdAt: "desc" }, select: { id: true, type: true, payload: true, createdAt: true } });
  return changes.map((c) => ({ id: c.id, type: c.type, message: (c.payload as { message?: string }).message ?? c.type, createdAt: c.createdAt.toISOString() }));
}

// ---------------------------------------------------------------- suggestions

export async function getSuggestions(scenarioId: string) {
  await assertAdmin();
  const list = await prisma.scenarioSuggestion.findMany({ where: { scenarioId }, orderBy: { createdAt: "desc" } });
  return list.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

/** Apply every change of a suggestion through the simulation engine (which validates and recalculates). */
export async function applySuggestion(suggestionId: string): Promise<R<{ view: SimView; messages: string[] }>> {
  try {
    const s = await assertAdmin();
    const sug = await prisma.scenarioSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    if (sug.status !== "PENDING") throw new SimError("Sugestia a fost deja procesată");
    const messages: string[] = [];
    for (const c of sug.changes as unknown[]) messages.push((await applyChange(sug.scenarioId, c)).message);
    await prisma.scenarioSuggestion.update({ where: { id: suggestionId }, data: { status: "APPLIED" } });
    await audit(s.userId, "ScenarioSuggestion", suggestionId, "APPLY", { changes: sug.changes });
    return { ok: true, messages, view: await getSimView(sug.scenarioId) };
  } catch (e) {
    return err(e);
  }
}

export async function dismissSuggestion(suggestionId: string): Promise<R> {
  try {
    const s = await assertAdmin();
    await prisma.scenarioSuggestion.update({ where: { id: suggestionId }, data: { status: "DISMISSED" } });
    await audit(s.userId, "ScenarioSuggestion", suggestionId, "DISMISS");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}
