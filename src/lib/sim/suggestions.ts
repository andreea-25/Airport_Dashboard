import { prisma } from "../db";
import { findImprovements, optimizeGreedy } from "./optimize";
import { loadScenarioData, previewChanges } from "./scenario";

/** Save the optimizer's best independent candidates as suggestions (used when Ollama is not available). */
export async function saveOptimizerSuggestions(scenarioId: string, count = 3): Promise<number> {
  const data = await loadScenarioData(scenarioId);
  const { candidates } = findImprovements(data, { limit: 10 });
  const used = new Set<string>();
  let saved = 0;
  for (const c of candidates) {
    if (saved >= count) break;
    if (c.employeeIds.some((e) => used.has(e))) continue;
    c.employeeIds.forEach((e) => used.add(e));
    const r = await previewChanges(scenarioId, c.changes);
    await prisma.scenarioSuggestion.create({
      data: { scenarioId, source: "OPTIMIZER", changes: c.changes as object, rationale: c.description, estimatedImpact: { messages: r.messages, ...r.impact } as object },
    });
    saved++;
  }
  return saved;
}

/** Run the greedy optimizer and store the combined result as one suggestion (not applied). */
export async function saveGreedySuggestion(scenarioId: string, steps = 5) {
  const data = await loadScenarioData(scenarioId);
  const g = optimizeGreedy(data, { steps });
  if (!g.changes.length) return null;
  const r = await previewChanges(scenarioId, g.changes);
  return prisma.scenarioSuggestion.create({
    data: {
      scenarioId,
      source: "OPTIMIZER",
      changes: g.changes as object,
      rationale: `Optimizare automată în ${g.steps.length} pași: scor ${g.startScore.toFixed(1)} → ${g.endScore.toFixed(1)}. ` + g.steps.map((s, i) => `(${i + 1}) ${s.description}`).join(" "),
      estimatedImpact: { messages: r.messages, ...r.impact } as object,
    },
  });
}
