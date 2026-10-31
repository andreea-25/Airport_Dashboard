"use client";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { autoOptimizeAction, findImprovementsAction } from "@/app/actions/simulation";
import type { Candidate } from "@/lib/sim/optimize";
import { ro } from "@/lib/i18n/ro";

type Emp = { id: string; name: string; departmentId: string };

export default function OptimizerPanel({
  scenarioId,
  departments,
  employees,
  pending,
  onApply,
  onFlash,
}: {
  scenarioId: string;
  departments: { id: string; name: string }[];
  employees: Emp[];
  pending: boolean;
  onApply: (changes: unknown[], label: string) => Promise<boolean>;
  onFlash: (ok: boolean, text: string) => void;
}) {
  const [dept, setDept] = useState("");
  const [exclude, setExclude] = useState<string[]>([]);
  const [result, setResult] = useState<{ candidates: Candidate[]; score: number; evaluated: number } | null>(null);
  const [busy, start] = useTransition();
  const t = ro.sim.opt;

  const search = () =>
    start(async () => {
      const r = await findImprovementsAction(scenarioId, { departmentId: dept || null, excludeEmployeeIds: exclude });
      if (r.ok) setResult(r);
      else onFlash(false, r.error);
    });

  const deltaPart = (label: string, [a, b]: [number, number], higherIsBetter: boolean, suffix = "") =>
    a === b ? null : (
      <span className={clsx("tabular-nums", (higherIsBetter ? b > a : b < a) ? "text-emerald-700" : "text-red-700")}>
        {label} {a}
        {suffix} → {b}
        {suffix}
      </span>
    );

  return (
    <section className="card card-pad space-y-3">
      <div>
        <h2 className="h2">⚙ {t.title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t.help}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">{t.onlyDept}</label>
          <select className="input py-1.5" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{ro.common.all}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="label">{t.exclude}</label>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-300 bg-white p-1">
            {exclude.map((id) => (
              <span key={id} className="badge bg-slate-100 text-slate-700">
                {employees.find((e) => e.id === id)?.name}
                <button className="ml-1 text-slate-400 hover:text-red-600" onClick={() => setExclude(exclude.filter((x) => x !== id))}>×</button>
              </span>
            ))}
            <select className="min-w-[140px] flex-1 bg-transparent py-0.5 text-sm outline-none" value="" onChange={(e) => e.target.value && setExclude([...exclude, e.target.value])}>
              <option value="">{t.excludeAdd}</option>
              {employees.filter((e) => (!dept || e.departmentId === dept) && !exclude.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn-primary" disabled={busy || pending} onClick={search}>{busy ? ro.common.loading : t.find}</button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">
            {ro.sim.score}: <b className="text-slate-800">{result.score.toFixed(1)}</b> · {result.evaluated} {t.evaluated}
          </div>
          {result.candidates.length === 0 && <p className="muted">{t.none}</p>}
          {result.candidates.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 p-2.5">
              <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-emerald-50 py-1 text-emerald-800">
                <span className="text-sm font-semibold tabular-nums">+{c.delta.toFixed(2)}</span>
                <span className="text-[10px] uppercase">scor</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="badge mr-1 bg-slate-100 text-slate-600">{t.kinds[c.kind]}</span>
                  {c.description}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {deltaPart(ro.sim.avgCoverage, c.impact.coverage, true, "%")}
                  {deltaPart(ro.sim.understaffed, c.impact.understaffed, false)}
                  {deltaPart(ro.sim.violations, c.impact.violations, false)}
                  {deltaPart(ro.sim.overtime, c.impact.overtime, false)}
                  {deltaPart(ro.sim.mismatches, c.impact.mismatches, false)}
                </div>
              </div>
              <button
                className="btn-primary btn-sm"
                disabled={pending || busy}
                onClick={async () => {
                  const ok = await onApply(c.changes, "Optimizator");
                  if (ok) setResult(null); // other candidates were computed on the old state
                }}
              >
                {t.apply}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
        <div className="max-w-xl">
          <div className="text-sm font-semibold">{t.auto}</div>
          <div className="text-xs text-slate-500">{t.autoHelp}</div>
        </div>
        <button
          className="btn-secondary"
          disabled={busy || pending}
          onClick={() =>
            start(async () => {
              const r = await autoOptimizeAction(scenarioId, 5);
              onFlash(r.ok, r.ok ? r.message : r.error);
            })
          }
        >
          {busy ? ro.common.loading : t.autoRun}
        </button>
      </div>
    </section>
  );
}
