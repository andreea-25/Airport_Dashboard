import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmt, localTimeStr } from "@/lib/time";
import { getHistory, getSimView, getSuggestions } from "@/app/actions/simulation";
import { loadScenarioData } from "@/lib/sim/scenario";
import SimWorkspace from "@/components/sim/SimWorkspace";

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const scenario = await prisma.scenario.findUnique({ where: { id } });
  if (!scenario) notFound();
  const [view, history, suggestions, data] = await Promise.all([getSimView(id), getHistory(id), getSuggestions(id), loadScenarioData(id)]);
  const departments = Object.values(data.departments).sort((a, b) => a.name.localeCompare(b.name, "ro"));
  const startTimes: Record<string, string[]> = {};
  for (const s of data.shifts) {
    const t = localTimeStr(s.startAt);
    const arr = (startTimes[s.departmentId] ??= []);
    if (!arr.includes(t)) arr.push(t);
  }
  for (const k of Object.keys(startTimes)) startTimes[k].sort();
  return (
    <SimWorkspace
      scenario={{ id, name: scenario.name, notes: scenario.notes, period: `${fmt(scenario.periodStart, "dd.MM")} – ${fmt(new Date(scenario.periodEnd.getTime() - 1), "dd.MM.yyyy")}` }}
      view={view}
      history={history}
      suggestions={suggestions.map((s) => ({ id: s.id, source: s.source, rationale: s.rationale, status: s.status, changes: s.changes, estimatedImpact: s.estimatedImpact, createdAt: s.createdAt }))}
      departments={departments}
      teams={Object.values(data.teams).sort((a, b) => a.name.localeCompare(b.name))}
      employees={Object.values(data.employees).map((e) => ({ id: e.id, name: e.name, departmentId: e.departmentId, teamId: e.teamId, level: e.levelName })).sort((a, b) => a.name.localeCompare(b.name, "ro"))}
      levels={Object.values(data.levels).sort((a, b) => a.rank - b.rank).map((l) => ({ id: l.id, name: l.name }))}
      startTimes={startTimes}
    />
  );
}
