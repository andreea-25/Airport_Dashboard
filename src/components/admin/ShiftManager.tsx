"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { assignEmployee, copyWeek, deleteShift, saveShift, unassign, updateAssignment } from "@/app/actions/admin";
import { ro } from "@/lib/i18n/ro";

type Assignment = { id: string; employeeId: string; name: string; level: string; rank: number; positionId: string | null; isLead: boolean; missing: string[] };
type ShiftRow = { id: string; date: string; start: string; end: string; teamId: string | null; teamName: string | null; required: number; assignments: Assignment[] };
type Props = {
  departmentId: string;
  monday: string;
  days: { date: string; label: string }[];
  shifts: ShiftRow[];
  teams: { id: string; name: string }[];
  employees: { id: string; name: string; teamName: string | null }[];
  positions: { id: string; name: string }[];
  templates: { id: string; name: string; start: string; end: string }[];
};

export default function ShiftManager(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ date: p.days[0].date, templateId: p.templates[0]?.id ?? "", start: p.templates[0]?.start ?? "06:00", end: p.templates[0]?.end ?? "14:00", teamId: "" });
  const run = (fn: () => Promise<{ error?: string; count?: number }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? ok ?? null);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-end gap-2">
        <div><label className="label">{ro.common.date}</label>
          <select className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>
            {p.days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
          </select>
        </div>
        <div><label className="label">Șablon</label>
          <select className="input" value={form.templateId} onChange={(e) => { const t = p.templates.find((x) => x.id === e.target.value); setForm({ ...form, templateId: e.target.value, start: t?.start ?? form.start, end: t?.end ?? form.end }); }}>
            <option value="">—</option>
            {p.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div><label className="label">{ro.shifts.start}</label><input type="time" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, templateId: "" })} /></div>
        <div><label className="label">{ro.shifts.end}</label><input type="time" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value, templateId: "" })} /></div>
        <div><label className="label">{ro.shifts.team}</label>
          <select className="input" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
            <option value="">—</option>
            {p.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn-primary" disabled={pending} onClick={() => run(() => saveShift(null, { departmentId: p.departmentId, ...form }), "✓")}>+ {ro.admin.addShift}</button>
        <div className="flex-1" />
        <button className="btn-secondary" disabled={pending} onClick={() => run(async () => { const r = await copyWeek(p.monday, p.departmentId); return r.error ? r : { ...r, error: undefined }; }, ro.admin.copyWeekDone)}>
          {ro.admin.copyWeek}
        </button>
      </div>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      <div className="grid gap-3 lg:grid-cols-7">
        {p.days.map((d) => (
          <div key={d.date} className="space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500">{d.label}</div>
            {p.shifts.filter((s) => s.date === d.date).map((s) => {
              const low = s.assignments.length < s.required;
              const lead = s.assignments.find((a) => a.isLead);
              const noSenior = s.assignments.length > 0 && !s.assignments.some((a) => a.rank >= 3);
              return (
                <button key={s.id} onClick={() => setOpen(open === s.id ? null : s.id)}
                  className={clsx("w-full rounded-lg border bg-white p-2 text-left text-xs shadow-sm hover:border-brand-500", open === s.id && "ring-2 ring-brand-500")}>
                  <div className="flight-board font-semibold">{s.start}–{s.end}</div>
                  <div className="text-slate-500">{s.teamName}</div>
                  <div className={clsx("mt-1 font-medium", low ? "text-red-600" : "text-emerald-700")}>{s.assignments.length}/{s.required} {ro.admin.people}</div>
                  {lead ? <div className="truncate text-slate-700">★ {lead.name}</div> : <div className="text-red-600">{ro.shifts.noLead}</div>}
                  {noSenior && <div className="text-amber-700">{ro.shifts.noSenior}</div>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {open && (() => {
        const s = p.shifts.find((x) => x.id === open);
        if (!s) return null;
        const free = p.employees.filter((e) => !s.assignments.some((a) => a.employeeId === e.id));
        return (
          <div className="card card-pad space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">{s.date} · {s.start}–{s.end} · {s.teamName}</h2>
              <div className="flex gap-2">
                <Link href={`/shifts/${s.id}`} className="btn-secondary btn-sm">{ro.comments.title}</Link>
                <EditTimes s={s} departmentId={p.departmentId} run={run} pending={pending} />
                <button className="btn-danger btn-sm" disabled={pending} onClick={() => { setOpen(null); run(() => deleteShift(s.id)); }}>{ro.common.delete}</button>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>{ro.sim.employee}</th><th>{ro.shifts.level}</th><th>{ro.shifts.position}</th><th>{ro.admin.isLead}</th><th /></tr></thead>
              <tbody>
                {s.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}{a.missing.length > 0 && <div className="text-xs text-red-600">⚠ {a.missing.join(", ")}</div>}</td>
                    <td>{a.level}</td>
                    <td>
                      <select className="input py-1" value={a.positionId ?? ""} disabled={pending} onChange={(e) => run(() => updateAssignment(a.id, { positionId: e.target.value || null }))}>
                        <option value="">—</option>
                        {p.positions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" checked={a.isLead} disabled={pending} onChange={(e) => run(() => updateAssignment(a.id, { isLead: e.target.checked }))} /></td>
                    <td><button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => run(() => unassign(a.id))}>{ro.admin.unassign}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AddAssignment free={free} positions={p.positions} onAdd={(emp, pos) => run(() => assignEmployee(s.id, emp, pos))} pending={pending} />
          </div>
        );
      })()}
    </div>
  );
}

function EditTimes({ s, departmentId, run, pending }: { s: ShiftRow; departmentId: string; run: (fn: () => Promise<{ error?: string }>) => void; pending: boolean }) {
  const [t, setT] = useState({ start: s.start, end: s.end });
  return (
    <span className="flex items-center gap-1">
      <input type="time" className="input w-28 py-1" value={t.start} onChange={(e) => setT({ ...t, start: e.target.value })} />
      <input type="time" className="input w-28 py-1" value={t.end} onChange={(e) => setT({ ...t, end: e.target.value })} />
      <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(() => saveShift(s.id, { departmentId, teamId: s.teamId, date: s.date, start: t.start, end: t.end }))}>{ro.common.save}</button>
    </span>
  );
}

function AddAssignment({ free, positions, onAdd, pending }: { free: { id: string; name: string; teamName: string | null }[]; positions: { id: string; name: string }[]; onAdd: (e: string, p: string | null) => void; pending: boolean }) {
  const [emp, setEmp] = useState("");
  const [pos, setPos] = useState("");
  return (
    <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-2">
      <select className="input max-w-xs" value={emp} onChange={(e) => setEmp(e.target.value)}>
        <option value="">{ro.sim.employee}…</option>
        {free.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.teamName ?? "—"})</option>)}
      </select>
      <select className="input max-w-xs" value={pos} onChange={(e) => setPos(e.target.value)}>
        <option value="">{ro.shifts.position}…</option>
        {positions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button className="btn-primary" disabled={pending || !emp} onClick={() => { onAdd(emp, pos || null); setEmp(""); }}>{ro.admin.assign}</button>
    </div>
  );
}
