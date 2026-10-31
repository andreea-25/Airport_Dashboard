"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { CalendarData, CalShift } from "@/lib/sim/calendar";
import { ro } from "@/lib/i18n/ro";

type Dept = { id: string; name: string; code: string };
type Team = { id: string; name: string; departmentId: string };
type DragPayload = { kind: "assignment"; assignmentId: string; employeeId: string; fromShiftId: string } | { kind: "employee"; employeeId: string };

const DAY_NAMES = ["Du", "Lu", "Ma", "Mi", "Jo", "Vi", "Sâ"];
const dayLabel = (d: string) => `${DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}`;

function covClass(s: CalShift) {
  if (s.required === 0) return "border-slate-200";
  if (s.deficit > 0) return s.minPct < 75 ? "border-red-400" : "border-amber-400";
  return "border-emerald-300";
}

export default function ScenarioCalendar({
  calendar,
  departments,
  teams,
  pending,
  onChanges,
}: {
  calendar: CalendarData;
  departments: Dept[];
  teams: Team[];
  pending: boolean;
  /** apply changes; resolves when the server has saved (or failed) */
  onChanges: (changes: unknown[], label: string) => Promise<boolean>;
}) {
  const [dept, setDept] = useState(departments.find((d) => d.code === "SEC")?.id ?? departments[0].id);
  const [shifts, setShifts] = useState(calendar.shifts);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => setShifts(calendar.shifts), [calendar.shifts]);

  const deptTeams = teams.filter((t) => t.departmentId === dept);
  const deptShifts = shifts.filter((s) => s.departmentId === dept);
  const rows: { id: string | null; name: string }[] = [...deptTeams.map((t) => ({ id: t.id, name: t.name }))];
  if (deptShifts.some((s) => !s.teamId || !deptTeams.some((t) => t.id === s.teamId))) rows.push({ id: null, name: ro.sim.cal.noTeam });
  const pool = useMemo(
    () => calendar.employees.filter((e) => e.departmentId === dept && (!q || e.name.toLowerCase().includes(q.toLowerCase()))),
    [calendar.employees, dept, q],
  );

  /** optimistic local update, then save; the page refresh brings the recalculated indicators */
  const drop = async (target: CalShift) => {
    const p = drag;
    setDrag(null);
    setOver(null);
    if (!p) return;
    if (p.kind === "assignment") {
      if (p.fromShiftId === target.id) return;
      const prev = shifts;
      setShifts((list) => {
        const from = list.find((s) => s.id === p.fromShiftId);
        const a = from?.assignments.find((x) => x.id === p.assignmentId);
        if (!from || !a) return list;
        return list.map((s) =>
          s.id === from.id ? { ...s, assignments: s.assignments.filter((x) => x.id !== a.id) } : s.id === target.id ? { ...s, assignments: [...s.assignments, { ...a, warnings: [] }] } : s,
        );
      });
      const ok = await onChanges([{ type: "MOVE_ASSIGNMENT", assignmentId: p.assignmentId, toShiftId: target.id }], "");
      if (!ok) setShifts(prev);
    } else {
      if (target.assignments.some((a) => a.employeeId === p.employeeId)) return;
      const e = calendar.employees.find((x) => x.id === p.employeeId);
      const prev = shifts;
      setShifts((list) =>
        list.map((s) =>
          s.id === target.id ? { ...s, assignments: [...s.assignments, { id: `tmp_${p.employeeId}`, employeeId: p.employeeId, name: e?.name ?? "", level: e?.level ?? "", rank: e?.rank ?? 0, isLead: false, position: null, warnings: [] }] } : s,
        ),
      );
      const ok = await onChanges([{ type: "ADD_ASSIGNMENT", shiftId: target.id, employeeId: p.employeeId }], "");
      if (!ok) setShifts(prev);
    }
  };

  const remove = async (s: CalShift, assignmentId: string, employeeId: string) => {
    const prev = shifts;
    setShifts((list) => list.map((x) => (x.id === s.id ? { ...x, assignments: x.assignments.filter((a) => a.id !== assignmentId) } : x)));
    const ok = await onChanges([{ type: "REMOVE_ASSIGNMENT", assignmentId }], "");
    if (!ok) setShifts(prev);
  };
  const toggleLead = (assignmentId: string, isLead: boolean, employeeId: string) =>
    onChanges([{ type: "SET_ASSIGNMENT", assignmentId, isLead: !isLead }], "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => (
          <button key={d.id} onClick={() => setDept(d.id)} className={clsx("badge px-3 py-1", d.id === dept ? "bg-slate-900 text-white" : "border bg-white text-slate-700 hover:bg-slate-50")}>
            {d.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{ro.sim.cal.hint}</p>
      <div className="grid gap-3 xl:grid-cols-[1fr_220px]">
        <div className={clsx("card overflow-x-auto p-2 transition-opacity", pending && "opacity-70")}>
          <table className="w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-20" />
                {calendar.days.map((d) => (
                  <th key={d} className="min-w-[132px] font-medium text-slate-500">{dayLabel(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? "none"}>
                  <td className="align-top pt-2 text-xs font-semibold text-slate-700">{row.name}</td>
                  {calendar.days.map((d) => {
                    const cell = deptShifts.filter((s) => s.date === d && (row.id ? s.teamId === row.id : !s.teamId || !deptTeams.some((t) => t.id === s.teamId)));
                    return (
                      <td key={d} className="align-top">
                        <div className="space-y-1">
                          {cell.map((s) => (
                            <div
                              key={s.id}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setOver(s.id);
                              }}
                              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                              onDrop={(e) => {
                                e.preventDefault();
                                drop(s);
                              }}
                              className={clsx("rounded-lg border-2 bg-white p-1.5", covClass(s), over === s.id && "ring-2 ring-brand-500 bg-brand-50")}
                            >
                              <div className="mb-1 flex items-center justify-between">
                                <span className="flight-board font-semibold text-slate-800">{s.start}–{s.end}</span>
                                {s.required > 0 && (
                                  <span className={clsx("rounded px-1 font-semibold tabular-nums", s.deficit > 0 ? "bg-red-100 text-red-800" : "bg-emerald-50 text-emerald-800")} title={`necesar maxim ${s.required}, acoperire minimă ${s.minPct}%`}>
                                    {s.assignments.length}/{s.required}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-0.5">
                                {s.assignments.map((a) => (
                                  <div
                                    key={a.id}
                                    draggable={!pending && !a.id.startsWith("tmp_")}
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", a.id);
                                      setDrag({ kind: "assignment", assignmentId: a.id, employeeId: a.employeeId, fromShiftId: s.id });
                                    }}
                                    onDragEnd={() => setDrag(null)}
                                    title={[a.level, a.position, ...a.warnings].filter(Boolean).join(" · ")}
                                    className={clsx(
                                      "group flex cursor-grab items-center gap-1 rounded px-1 py-0.5 active:cursor-grabbing",
                                      a.warnings.length ? "bg-red-50 text-red-900" : a.isLead ? "bg-amber-50 text-amber-950" : "bg-slate-100 text-slate-800",
                                    )}
                                  >
                                    <button
                                      className={clsx("leading-none", a.isLead ? "text-amber-500" : "text-slate-300 hover:text-amber-500")}
                                      onClick={() => toggleLead(a.id, a.isLead, a.employeeId)}
                                      disabled={pending || a.id.startsWith("tmp_")}
                                      aria-label={ro.admin.isLead}
                                    >
                                      ★
                                    </button>
                                    <span className="min-w-0 flex-1 truncate">
                                      {a.name.split(" ")[0]} {a.name.split(" ").slice(1).join(" ").charAt(0)}.
                                      <span className="ml-1 text-[10px] text-slate-500">{a.rank >= 3 ? a.level.replace("Supervizor", "Sup.").replace("Team Lead", "TL") : ""}</span>
                                    </span>
                                    {a.warnings.length > 0 && <span className="text-red-600">⚠</span>}
                                    <button
                                      className="text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                                      onClick={() => remove(s, a.id, a.employeeId)}
                                      disabled={pending || a.id.startsWith("tmp_")}
                                      aria-label={ro.common.delete}
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                {s.assignments.length === 0 && <div className="py-1 text-center text-slate-400">{ro.sim.cal.dropHere}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="card flex max-h-[640px] flex-col p-2">
          <div className="px-1 pb-2">
            <div className="text-sm font-semibold">{ro.sim.cal.pool}</div>
            <div className="text-[11px] text-slate-500">{ro.sim.cal.poolHint}</div>
            <input className="input mt-1.5 py-1 text-xs" placeholder={ro.sim.cal.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="flex-1 space-y-0.5 overflow-y-auto text-xs">
            {pool.map((e) => (
              <li
                key={e.id}
                draggable={!pending}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "copy";
                  ev.dataTransfer.setData("text/plain", e.id);
                  setDrag({ kind: "employee", employeeId: e.id });
                }}
                onDragEnd={() => setDrag(null)}
                className="flex cursor-grab items-center justify-between rounded px-1.5 py-1 hover:bg-slate-100"
                title={e.absent.length ? `${ro.sim.cal.absent}: ${e.absent.join(", ")}` : undefined}
              >
                <span className="truncate">
                  {e.name}
                  <span className="ml-1 text-[10px] text-slate-400">{teams.find((t) => t.id === e.teamId)?.name.replace("Echipa ", "")} · {e.level}</span>
                  {e.absent.length > 0 && <span className="ml-1 text-[10px] text-red-600">{ro.sim.cal.absent}</span>}
                </span>
                <span className="ml-1 shrink-0 tabular-nums text-slate-500">{e.hours}h</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
