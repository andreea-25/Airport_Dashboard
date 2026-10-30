"use client";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SimView } from "@/app/actions/simulation";
import { ro } from "@/lib/i18n/ro";

type Key = keyof SimView["real"]["summary"];
const KPIS: { key: Key; label: string; higherIsBetter: boolean; suffix?: string }[] = [
  { key: "avgCoverage", label: ro.sim.avgCoverage, higherIsBetter: true, suffix: "%" },
  { key: "understaffedSlots", label: ro.sim.understaffed, higherIsBetter: false },
  { key: "totalHours", label: ro.sim.totalHours, higherIsBetter: false },
  { key: "totalOvertime", label: ro.sim.overtime, higherIsBetter: false },
  { key: "violationCount", label: ro.sim.violations, higherIsBetter: false },
  { key: "mismatchCount", label: ro.sim.mismatches, higherIsBetter: false },
  { key: "expiringCount", label: ro.sim.expiring, higherIsBetter: false },
];

export function KpiRow({ view, refLabel = ro.sim.vsReal }: { view: SimView; refLabel?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {KPIS.map((k) => {
        const d = view.diff.summary[k.key];
        const delta = d.delta;
        const good = delta === 0 ? null : k.higherIsBetter ? delta > 0 : delta < 0;
        return (
          <div key={k.key} className="card px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {d.b}
              {k.suffix}
            </div>
            <div className={clsx("text-xs tabular-nums", good === null ? "text-slate-400" : good ? "text-emerald-700" : "text-red-700")}>
              {delta === 0 ? "=" : `${good ? "▲" : "▼"} ${delta > 0 ? "+" : ""}${delta}${k.suffix ?? ""}`} <span className="text-slate-400">{refLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const REF_COLOR = "#94a3b8"; // slate-400: the reference (real schedule)
const SCN_COLOR = "#1659c7"; // brand-600: the scenario

export function DeptCoverageChart({ view, refName = ro.sim.real, scnName = "Scenariu" }: { view: SimView; refName?: string; scnName?: string }) {
  const data = view.diff.byDept.map((d) => ({ name: d.name.replace(/ \(.*\)/, "").replace("Informații pasageri și îmbarcare", "Îmbarcare"), [refName]: d.a, [scnName]: d.b }));
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 40, left: -10 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} interval={0} angle={-25} textAnchor="end" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
          <YAxis domain={[50, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} unit="%" />
          <Tooltip formatter={(v) => `${v}%`} cursor={{ fill: "#f1f5f9" }} />
          <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={refName} fill={REF_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey={scnName} fill={SCN_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function cell(pct: number) {
  if (pct >= 100) return "bg-emerald-100 text-emerald-900";
  if (pct >= 90) return "bg-amber-100 text-amber-900";
  if (pct >= 75) return "bg-orange-200 text-orange-900";
  return "bg-red-300 text-red-950";
}

/** Department × hour of day: average coverage over the period (min in tooltip). */
export function CoverageHeatmap({ view, departments }: { view: SimView; departments: { id: string; name: string }[] }) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th />
            {hours.map((h) => <th key={h} className="font-normal text-slate-400">{String(h).padStart(2, "0")}</th>)}
          </tr>
        </thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap pr-2 text-xs text-slate-700">{d.name}</td>
              {hours.map((h) => {
                const c = view.scenario.coverageByHour.find((x) => x.departmentId === d.id && x.hour === h);
                const r = view.real.coverageByHour.find((x) => x.departmentId === d.id && x.hour === h);
                if (!c) return <td key={h} className="h-7 rounded bg-slate-50" />;
                const changed = r && r.avgPct !== c.avgPct;
                return (
                  <td key={h} title={`${d.name} ${h}:00 — medie ${c.avgPct}%, minim ${c.minPct}%${r ? ` (real: ${r.avgPct}%)` : ""}`}
                    className={clsx("h-7 min-w-[30px] rounded text-center tabular-nums", cell(c.avgPct), changed && "ring-2 ring-brand-500")}>
                    {c.avgPct}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-100" /> ≥100%</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-100" /> 90–99%</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-orange-200" /> 75–89%</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-300" /> &lt;75%</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded ring-2 ring-brand-500" /> diferă de programul real</span>
      </div>
    </div>
  );
}
