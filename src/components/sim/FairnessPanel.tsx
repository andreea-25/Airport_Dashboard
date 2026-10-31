"use client";
import { useState } from "react";
import clsx from "clsx";
import type { SimView } from "@/app/actions/simulation";
import { ro } from "@/lib/i18n/ro";

export default function FairnessPanel({ view, departments }: { view: SimView; departments: { id: string; name: string }[] }) {
  const t = ro.sim.fair;
  const f = view.scenario.fairness;
  const [dept, setDept] = useState(f.byDept[0]?.departmentId ?? departments[0]?.id);
  const d = f.byDept.find((x) => x.departmentId === dept);
  const people = f.perEmployee.filter((p) => p.departmentId === dept);
  // "much above average": more than average + 1 (and at least 2)
  const hi = (v: number, avg: number) => v >= 2 && v > avg + 1;
  const avgHours = people.length ? people.reduce((a, p) => a + p.hours, 0) / people.length : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="h2">{t.title}</h2>
        <p className="text-xs text-slate-500">{t.help} {t.nightDef}</p>
      </div>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>{t.people}</th>
              <th>{t.avgNights}</th>
              <th>{t.maxNights}</th>
              <th>{t.avgWeekends}</th>
              <th>{t.maxWeekends}</th>
              <th>{t.spread}</th>
            </tr>
          </thead>
          <tbody>
            {f.byDept.map((x) => (
              <tr key={x.departmentId} onClick={() => setDept(x.departmentId)} className={clsx("cursor-pointer hover:bg-slate-50", x.departmentId === dept && "bg-brand-50")}>
                <td className="font-medium">{x.name}</td>
                <td className="tabular-nums">{x.people}</td>
                <td className="tabular-nums">{x.avgNights}</td>
                <td className={clsx("tabular-nums", hi(x.maxNights, x.avgNights) && "font-semibold text-red-700")}>{x.maxNights}</td>
                <td className="tabular-nums">{x.avgWeekends}</td>
                <td className={clsx("tabular-nums", hi(x.maxWeekends, x.avgWeekends) && "font-semibold text-red-700")}>{x.maxWeekends}</td>
                <td className={clsx("tabular-nums", x.hoursSpread >= 16 && "font-semibold text-red-700")}>{x.hoursSpread}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {d && (
        <section className="card card-pad">
          <h3 className="h2 mb-2">{d.name}</h3>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <div key={p.employeeId} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
                <span className="truncate">{p.name}</span>
                <span className="flex gap-3 text-xs tabular-nums">
                  <span className={clsx(hi(p.nights, d.avgNights) && "font-semibold text-red-700")} title={t.nights}>🌙 {p.nights}</span>
                  <span className={clsx(hi(p.weekends, d.avgWeekends) && "font-semibold text-red-700")} title={t.weekends}>📅 {p.weekends}</span>
                  <span className={clsx(Math.abs(p.hours - avgHours) >= 12 && "font-semibold text-red-700")} title={t.hours}>⏱ {p.hours}h</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
