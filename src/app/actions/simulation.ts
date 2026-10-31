"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { addDaysStr, dateOnly, localInfo, localToUtc } from "@/lib/time";
import { ro } from "@/lib/i18n/ro";
import { findImprovements, type Candidate } from "@/lib/sim/optimize";
import { saveGreedySuggestion } from "@/lib/sim/suggestions";
import {
  applyChange,
  applyChanges,
  loadScenarioData,
  createScenarioFromReal,
  loadScenarioWithReal,
  duplicateScenario,
  previewChanges,
  skillGap,
  SimError,
  undoLastChange,
} from "@/lib/sim/scenario";
import type { Evaluation, ScenarioSettings, SimData } from "@/lib/sim/types";
import { buildCalendar, type CalendarData } from "@/lib/sim/calendar";
import { compare, evaluate, type Comparison } from "@/lib/sim/evaluate";

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

/** Everything the scenario page needs, from a single load of scenario + real data. */
export async function getSimPageData(scenarioId: string): Promise<{ view: SimView; data: SimData; calendar: CalendarData; settings: ScenarioSettings }> {
  await assertAdmin();
  const { scenario, real } = await loadScenarioWithReal(scenarioId);
  const a = evaluate(scenario);
  const b = evaluate(real);
  return {
    view: { scenario: slim(a), real: { summary: b.summary, coverageByDept: b.coverageByDept, coverageByHour: b.coverageByHour }, diff: compare(b, a) },
    data: scenario,
    calendar: buildCalendar(scenario, a),
    settings: scenario.settings,
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

export async function applySimChange(scenarioId: string, change: unknown): Promise<R<{ message: string }>> {
  try {
    const s = await assertAdmin();
    const { message } = await applyChange(scenarioId, change);
    await audit(s.userId, "Scenario", scenarioId, "APPLY_CHANGE", change);
    return { ok: true, message };
  } catch (e) {
    return err(e);
  }
}

export async function undoSimChange(scenarioId: string): Promise<R<{ message: string }>> {
  try {
    const s = await assertAdmin();
    const last = await undoLastChange(scenarioId);
    await audit(s.userId, "Scenario", scenarioId, "UNDO", { type: last.type });
    return { ok: true, message: `Anulat: ${(last.payload as { message?: string }).message ?? last.type}` };
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
export async function applySuggestion(suggestionId: string): Promise<R<{ messages: string[] }>> {
  try {
    const s = await assertAdmin();
    const sug = await prisma.scenarioSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    if (sug.status !== "PENDING") throw new SimError("Sugestia a fost deja procesată");
    const messages: string[] = [];
    messages.push(...(await applyChanges(sug.scenarioId, sug.changes as unknown[], sug.source === "AI" ? "Sugestie AI" : "Sugestie optimizator")).messages);
    await prisma.scenarioSuggestion.update({ where: { id: suggestionId }, data: { status: "APPLIED" } });
    await audit(s.userId, "ScenarioSuggestion", suggestionId, "APPLY", { changes: sug.changes });
    return { ok: true, messages };
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

// ---------------------------------------------------------------- optimizer

export async function findImprovementsAction(scenarioId: string, opts: { departmentId?: string | null; excludeEmployeeIds?: string[] } = {}): Promise<R<{ candidates: Candidate[]; score: number; evaluated: number }>> {
  try {
    await assertAdmin();
    const data = await loadScenarioData(scenarioId);
    const r = findImprovements(data, { limit: 10, departmentId: opts.departmentId || null, excludeEmployeeIds: opts.excludeEmployeeIds ?? [] });
    return { ok: true, candidates: r.candidates, score: r.base.score.total, evaluated: r.evaluated };
  } catch (e) {
    return err(e);
  }
}

/** Apply a batch of changes as one undoable step (optimizer candidate, what-if template, drag & drop…). */
export async function applySimChanges(scenarioId: string, changes: unknown[], label?: string): Promise<R<{ message: string }>> {
  try {
    const s = await assertAdmin();
    const r = await applyChanges(scenarioId, changes, label);
    await audit(s.userId, "Scenario", scenarioId, "APPLY_CHANGES", { label, changes });
    return { ok: true, message: r.message };
  } catch (e) {
    return err(e);
  }
}

export async function autoOptimizeAction(scenarioId: string, steps = 5): Promise<R<{ message: string }>> {
  try {
    const s = await assertAdmin();
    const sug = await saveGreedySuggestion(scenarioId, Math.min(10, Math.max(1, steps)));
    await audit(s.userId, "Scenario", scenarioId, "AUTO_OPTIMIZE", { steps, suggestionId: sug?.id });
    return { ok: true, message: sug ? "Optimizarea automată a fost salvată ca sugestie. Verific-o și aplic-o din panoul Sugestii." : "Optimizatorul nu a găsit îmbunătățiri." };
  } catch (e) {
    return err(e);
  }
}

// ---------------------------------------------------------------- apply to the real schedule

/**
 * Replace the real shifts/assignments of the scenario's period with the scenario's version.
 * Employee attributes (team, level), hypotheses (absences, traffic, expired skills) and rules are NOT applied.
 * Requires typing the scenario name; audited; affected employees are notified.
 */
export async function applyScenarioToReal(scenarioId: string, confirmName: string): Promise<R<{ message: string }>> {
  try {
    const s = await assertAdmin();
    const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
    if (!scenario) throw new SimError("Scenariu inexistent");
    if (confirmName.trim() !== scenario.name.trim()) throw new SimError("Numele scenariului nu corespunde");
    const data = await loadScenarioData(scenarioId);
    const sourceIds = data.shifts.map((x) => x.sourceShiftId).filter((x): x is string => !!x);
    const realBefore = await prisma.shift.findMany({ where: { id: { in: sourceIds } }, include: { assignments: true } });
    const beforeKeys = new Set(realBefore.flatMap((sh) => sh.assignments.map((a) => `${a.employeeId}|${sh.startAt.toISOString()}|${sh.endAt.toISOString()}`)));
    const realIds = new Set(realBefore.map((x) => x.id));
    let updated = 0;
    let created = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const sh of data.shifts) {
          const values = { departmentId: sh.departmentId, teamId: sh.teamId, startAt: sh.startAt, endAt: sh.endAt, date: dateOnly(localInfo(sh.startAt).date) };
          const assignments = sh.assignments.map((a) => ({ employeeId: a.employeeId, positionId: a.positionId, isLead: a.isLead }));
          if (sh.sourceShiftId && realIds.has(sh.sourceShiftId)) {
            await tx.shift.update({ where: { id: sh.sourceShiftId }, data: values });
            await tx.shiftAssignment.deleteMany({ where: { shiftId: sh.sourceShiftId } });
            if (assignments.length) await tx.shiftAssignment.createMany({ data: assignments.map((a) => ({ ...a, shiftId: sh.sourceShiftId! })) });
            updated++;
          } else {
            await tx.shift.create({ data: { ...values, assignments: { create: assignments } } });
            created++;
          }
        }
        await tx.scenario.update({ where: { id: scenarioId }, data: { settings: { ...data.settings, appliedAt: new Date().toISOString() } as object } });
      },
      { timeout: 60_000 },
    );
    // notify employees whose schedule changed
    const afterKeys = new Set(data.shifts.flatMap((sh) => sh.assignments.map((a) => `${a.employeeId}|${sh.startAt.toISOString()}|${sh.endAt.toISOString()}`)));
    const changedEmps = new Set<string>();
    for (const k of beforeKeys) if (!afterKeys.has(k)) changedEmps.add(k.split("|")[0]);
    for (const k of afterKeys) if (!beforeKeys.has(k)) changedEmps.add(k.split("|")[0]);
    const users = await prisma.user.findMany({ where: { employeeId: { in: [...changedEmps] } } });
    if (users.length) {
      await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: "SCHEDULE_CHANGED", message: "Programul tău de ture a fost actualizat" })) });
    }
    await audit(s.userId, "Scenario", scenarioId, "APPLY_TO_REAL", { name: scenario.name, updatedShifts: updated, createdShifts: created, employeesAffected: changedEmps.size });
    revalidatePath("/admin/shifts");
    revalidatePath("/admin/today");
    return { ok: true, message: `${ro.sim.applyReal.done} ${updated} ture actualizate, ${created} ture noi, ${changedEmps.size} angajați anunțați.` };
  } catch (e) {
    return err(e);
  }
}
