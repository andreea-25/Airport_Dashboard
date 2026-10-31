"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createScenario, deleteScenario, duplicateScenarioAction } from "@/app/actions/simulation";
import { ro } from "@/lib/i18n/ro";

type Row = { id: string; name: string; period: string; changes: number; avgCoverage: number; violations: number; score: number; notes: string | null };

export default function ScenarioList({ rows, defaultStart }: { rows: Row[]; defaultStart: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", start: defaultStart, days: "7", notes: "" });
  const [cmp, setCmp] = useState({ a: rows[0]?.id ?? "", b: "real" });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {rows.length === 0 && <p className="muted">{ro.common.noData}</p>}
        {rows.map((r) => (
          <div key={r.id} className="card card-pad flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/simulation/${r.id}`} className="text-base font-semibold text-brand-700 hover:underline">{r.name}</Link>
              <div className="text-sm text-slate-500">{r.period} · {r.changes} {ro.sim.changes.toLowerCase()}</div>
              {r.notes && <div className="mt-1 text-xs text-slate-500">{r.notes}</div>}
            </div>
            <div className="flex h-12 w-14 flex-col items-center justify-center rounded-lg bg-slate-900 text-white" title={ro.sim.scoreHelp}>
              <span className="text-lg font-semibold leading-none tabular-nums">{r.score.toFixed(0)}</span>
              <span className="text-[9px] uppercase tracking-wide text-slate-300">scor</span>
            </div>
            <div className="text-right text-sm">
              <div><b className="tabular-nums">{r.avgCoverage}%</b> <span className="text-slate-500">{ro.sim.avgCoverage.toLowerCase()}</span></div>
              <div><b className="tabular-nums">{r.violations}</b> <span className="text-slate-500">{ro.sim.violations.toLowerCase()}</span></div>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/simulation/${r.id}`} className="btn-primary btn-sm">Deschide</Link>
              <button className="btn-secondary btn-sm" disabled={pending} onClick={() => start(async () => { const x = await duplicateScenarioAction(r.id); if (!x.ok) setErr(x.error); router.refresh(); })}>{ro.sim.duplicate}</button>
              <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => confirm(`${ro.sim.deleteScenario}?`) && start(async () => { await deleteScenario(r.id); router.refresh(); })}>{ro.common.delete}</button>
            </div>
          </div>
        ))}
      </div>
      <aside className="space-y-5">
        <div className="card card-pad space-y-3">
          <h2 className="h2">{ro.sim.newScenario}</h2>
          <div><label className="label">{ro.sim.name}</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. Val de dimineață 05:00" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">{ro.sim.periodStart}</label><input type="date" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <div><label className="label">{ro.sim.periodDays}</label>
              <select className="input" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
                <option value="1">1</option><option value="7">7</option><option value="14">14</option>
              </select>
            </div>
          </div>
          <div><label className="label">{ro.sim.notes}</label><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          <button className="btn-primary w-full" disabled={pending || f.name.trim().length < 2}
            onClick={() => start(async () => { const r = await createScenario(f); if (r.ok) router.push(`/admin/simulation/${r.id}`); else setErr(r.error); })}>
            {pending ? ro.common.loading : ro.sim.createFromReal}
          </button>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        {rows.length > 0 && (
          <div className="card card-pad space-y-3">
            <h2 className="h2">{ro.sim.compare}</h2>
            <select className="input" value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: e.target.value })}>
              {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="text-center text-xs text-slate-500">{ro.sim.compareWith}</div>
            <select className="input" value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: e.target.value })}>
              <option value="real">{ro.sim.real}</option>
              {rows.filter((r) => r.id !== cmp.a).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Link className="btn-secondary w-full" href={`/admin/simulation/compare?a=${cmp.a}&b=${cmp.b}`}>{ro.sim.compare}</Link>
          </div>
        )}
      </aside>
    </div>
  );
}
