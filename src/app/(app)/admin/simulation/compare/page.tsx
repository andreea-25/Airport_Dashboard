import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { compareScenarios } from "@/lib/sim/scenario";
import { DeptCoverageChart, KpiRow } from "@/components/sim/Charts";
import type { SimView } from "@/app/actions/simulation";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  if (!sp.a) return <p className="muted">{ro.common.noData}</p>;
  const b = sp.b && sp.b !== "real" ? sp.b : "real";
  const [sa, sb] = await Promise.all([prisma.scenario.findUnique({ where: { id: sp.a } }), b === "real" ? null : prisma.scenario.findUnique({ where: { id: b } })]);
  if (!sa) return <p className="muted">{ro.common.noData}</p>;
  const r = await compareScenarios(sa.id, b);
  const view: SimView = {
    scenario: { ...r.a, topHours: r.a.hours.slice(0, 10) },
    real: { summary: r.b.summary, coverageByDept: r.b.coverageByDept, coverageByHour: r.b.coverageByHour },
    diff: r.diff,
  };
  const bName = sb?.name ?? ro.sim.real;
  const countBy = (ev: typeof r.a) => ev.violations.reduce<Record<string, number>>((acc, v) => ((acc[v.type] = (acc[v.type] ?? 0) + 1), acc), {});
  const va = countBy(r.a);
  const vb = countBy(r.b);
  return (
    <div className="space-y-5">
      <Link href="/admin/simulation" className="text-sm text-brand-600 hover:underline">‹ {ro.sim.scenarios}</Link>
      <h1 className="h1">
        {sa.name} <span className="text-slate-400">vs</span> {bName}
      </h1>
      <KpiRow view={view} refLabel={`vs ${bName}`} />
      <section className="card card-pad">
        <h2 className="h2 mb-2">{ro.sim.coverageByDept}</h2>
        <DeptCoverageChart view={view} refName={bName} scnName={sa.name} />
      </section>
      <section className="card card-pad overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th /><th>{bName}</th><th>{sa.name}</th><th>{ro.sim.delta}</th></tr>
          </thead>
          <tbody>
            {r.diff.byDept.map((d) => (
              <tr key={d.departmentId}>
                <td>{d.name}</td><td className="tabular-nums">{d.a}%</td><td className="tabular-nums">{d.b}%</td>
                <td className={clsx("tabular-nums", d.delta > 0 ? "text-emerald-700" : d.delta < 0 ? "text-red-700" : "text-slate-400")}>{d.delta > 0 ? "+" : ""}{d.delta}</td>
              </tr>
            ))}
            {Object.entries(ro.sim.violationTypes).map(([k, label]) => (
              <tr key={k}>
                <td>⚠ {label}</td><td className="tabular-nums">{vb[k] ?? 0}</td><td className="tabular-nums">{va[k] ?? 0}</td>
                <td className={clsx("tabular-nums", (va[k] ?? 0) < (vb[k] ?? 0) ? "text-emerald-700" : (va[k] ?? 0) > (vb[k] ?? 0) ? "text-red-700" : "text-slate-400")}>{(va[k] ?? 0) - (vb[k] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
