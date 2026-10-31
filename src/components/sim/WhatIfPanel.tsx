"use client";
import { useState } from "react";
import type { CalendarData } from "@/lib/sim/calendar";
import type { ScenarioSettings } from "@/lib/sim/types";
import { ro } from "@/lib/i18n/ro";

type Dept = { id: string; name: string; code: string };

export default function WhatIfPanel({
  settings,
  calendar,
  departments,
  skills,
  levels,
  pending,
  onApply,
  onFlash,
}: {
  settings: ScenarioSettings;
  calendar: CalendarData;
  departments: Dept[];
  skills: { id: string; name: string; type: string }[];
  levels: { id: string; name: string; rank: number }[];
  pending: boolean;
  onApply: (changes: unknown[], label: string) => Promise<boolean>;
  onFlash: (ok: boolean, text: string) => void;
}) {
  const t = ro.sim.whatif;
  const certs = skills.filter((s) => s.type === "CERTIFICATION");
  const deptName = (id: string | null) => (id ? departments.find((d) => d.id === id)?.name : t.allDepts);
  const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id;
  const empName = (id: string) => calendar.employees.find((e) => e.id === id)?.name ?? id;

  const [sick, setSick] = useState({ dept: departments.find((d) => d.code === "SEC")?.id ?? departments[0].id, day: calendar.days[1] ?? calendar.days[0], count: 3 });
  const [traffic, setTraffic] = useState({ dept: "", pct: 30, from: 5, to: 9 });
  const [expire, setExpire] = useState({ skill: certs.find((c) => c.name.includes("AVSEC"))?.id ?? certs[0]?.id ?? "", dept: "" });
  const [rules, setRules] = useState(settings.rules);

  const runSick = () => {
    const working = [...new Set(calendar.shifts.filter((s) => s.departmentId === sick.dept && s.date === sick.day).flatMap((s) => s.assignments.map((a) => a.employeeId)))];
    if (!working.length) return onFlash(false, t.noOneWorking);
    const picked = working.sort(() => Math.random() - 0.5).slice(0, sick.count);
    const dayIdx = new Date(`${sick.day}T12:00:00Z`).getUTCDay();
    const dayName = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"][dayIdx];
    onApply(
      picked.map((employeeId) => ({ type: "ADD_ABSENCE", employeeId, date: sick.day, reason: "Concediu medical" })),
      `Ce-ar fi dacă: ${picked.length} oameni în concediu medical ${dayName} (${deptName(sick.dept)})`,
    );
  };

  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <h2 className="h2">{t.title}</h2>
        <section className="card card-pad space-y-2">
          <h3 className="font-semibold">🤒 {t.sick}</h3>
          <p className="text-xs text-slate-500">{t.sickHelp}</p>
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={sick.dept} onChange={(e) => setSick({ ...sick, dept: e.target.value })}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input" value={sick.day} onChange={(e) => setSick({ ...sick, day: e.target.value })} aria-label={t.day}>
              {calendar.days.map((d) => <option key={d} value={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { weekday: "long", day: "2-digit", month: "2-digit" })}</option>)}
            </select>
            <select className="input" value={sick.count} onChange={(e) => setSick({ ...sick, count: Number(e.target.value) })} aria-label={t.people}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? "om" : "oameni"}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{t.random}</span>
            <button className="btn-primary btn-sm" disabled={pending} onClick={runSick}>{t.run}</button>
          </div>
        </section>

        <section className="card card-pad space-y-2">
          <h3 className="font-semibold">✈ {t.traffic}</h3>
          <p className="text-xs text-slate-500">{t.trafficHelp}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select className="input" value={traffic.dept} onChange={(e) => setTraffic({ ...traffic, dept: e.target.value })}>
              <option value="">{t.allDepts}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input" value={traffic.pct} onChange={(e) => setTraffic({ ...traffic, pct: Number(e.target.value) })} aria-label={t.increase}>
              {[10, 20, 30, 50, 75, 100].map((p) => <option key={p} value={p}>+{p}%</option>)}
            </select>
            <select className="input" value={traffic.from} onChange={(e) => setTraffic({ ...traffic, from: Number(e.target.value) })} aria-label={t.from}>
              {hours.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
            <select className="input" value={traffic.to} onChange={(e) => setTraffic({ ...traffic, to: Number(e.target.value) })} aria-label={t.to}>
              {hours.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              className="btn-primary btn-sm"
              disabled={pending || traffic.from >= traffic.to}
              onClick={() =>
                onApply([{ type: "ADJUST_STAFFING", departmentId: traffic.dept || null, startHour: traffic.from, endHour: traffic.to, factor: 1 + traffic.pct / 100 }], "Ce-ar fi dacă")
              }
            >
              {t.run}
            </button>
          </div>
        </section>

        <section className="card card-pad space-y-2">
          <h3 className="font-semibold">📛 {t.expire}</h3>
          <p className="text-xs text-slate-500">{t.expireHelp}</p>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={expire.skill} onChange={(e) => setExpire({ ...expire, skill: e.target.value })} aria-label={t.cert}>
              {certs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input" value={expire.dept} onChange={(e) => setExpire({ ...expire, dept: e.target.value })}>
              <option value="">{t.allDepts}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary btn-sm" disabled={pending || !expire.skill} onClick={() => onApply([{ type: "EXPIRE_SKILL", skillId: expire.skill, departmentId: expire.dept || null }], "Ce-ar fi dacă")}>
              {t.run}
            </button>
          </div>
        </section>
      </div>

      <div className="space-y-5">
        <section className="card card-pad space-y-2">
          <h3 className="h2">{t.active}</h3>
          {!settings.staffingAdjustments.length && !settings.absences.length && !settings.expiredSkills.length && <p className="muted">{t.noneActive}</p>}
          <ul className="space-y-1 text-sm">
            {settings.staffingAdjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-md bg-sky-50 px-2.5 py-1.5">
                <span>✈ {a.label}</span>
                <button className="btn-ghost btn-sm" disabled={pending} onClick={() => onApply([{ type: "REMOVE_STAFFING_ADJUSTMENT", id: a.id }], "")}>{t.remove}</button>
              </li>
            ))}
            {settings.absences.map((a) => (
              <li key={a.employeeId + a.date} className="rounded-md bg-rose-50 px-2.5 py-1.5">🤒 {empName(a.employeeId)} · {a.reason} · {a.date}</li>
            ))}
            {settings.expiredSkills.map((x, i) => (
              <li key={i} className="rounded-md bg-amber-50 px-2.5 py-1.5">📛 {skillName(x.skillId)} expirat · {deptName(x.departmentId)}</li>
            ))}
          </ul>
          {(settings.absences.length > 0 || settings.expiredSkills.length > 0) && <p className="text-xs text-slate-500">{t.undoHint}</p>}
        </section>

        <section className="card card-pad space-y-3">
          <div>
            <h3 className="h2">{t.rules}</h3>
            <p className="text-xs text-slate-500">{t.rulesHelp}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t.minRest}</label>
              <input type="number" min={0} max={24} className="input" value={rules.minRestHours} onChange={(e) => setRules({ ...rules, minRestHours: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t.maxWeekly}</label>
              <input type="number" min={8} max={84} className="input" value={rules.maxWeeklyHours} onChange={(e) => setRules({ ...rules, maxWeeklyHours: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t.normalWeekly}</label>
              <input type="number" min={8} max={84} className="input" value={rules.normalWeeklyHours} onChange={(e) => setRules({ ...rules, normalWeeklyHours: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t.leadRank}</label>
              <select className="input" value={rules.leadMinRank} onChange={(e) => setRules({ ...rules, leadMinRank: Number(e.target.value) })}>
                {levels.map((l) => <option key={l.id} value={l.rank}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={pending || JSON.stringify(rules) === JSON.stringify(settings.rules)} onClick={() => onApply([{ type: "SET_RULES", rules }], "")}>
              {t.saveRules}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
