import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { addDaysStr, fmt, mondayOf } from "@/lib/time";
import { evaluateScenario } from "@/lib/sim/scenario";
import ScenarioList from "@/components/sim/ScenarioList";

export default async function SimulationPage() {
  await requireAdminPage();
  const scenarios = await prisma.scenario.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { changes: true } } } });
  const rows = await Promise.all(
    scenarios.map(async (s) => {
      const ev = await evaluateScenario(s.id);
      return {
        id: s.id,
        name: s.name,
        notes: s.notes,
        period: `${fmt(s.periodStart, "dd.MM")} – ${fmt(new Date(s.periodEnd.getTime() - 1), "dd.MM.yyyy")}`,
        changes: s._count.changes,
        avgCoverage: ev.summary.avgCoverage,
        violations: ev.summary.violationCount,
      };
    }),
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">{ro.sim.title}</h1>
        <p className="muted">{ro.sim.subtitle} {ro.sim.readOnlyNote}</p>
      </div>
      <ScenarioList rows={rows} defaultStart={addDaysStr(mondayOf(new Date()), 7)} />
    </div>
  );
}
