import Link from "next/link";
import clsx from "clsx";
import { requireSession } from "@/lib/auth";
import { getMyShifts, getTeamShifts } from "@/lib/services/employee";
import { ro } from "@/lib/i18n/ro";
import { addDaysStr, fmt, localDateStr, localToUtc, mondayOf } from "@/lib/time";
import { deptColor } from "@/lib/ui";
import { redirect } from "next/navigation";

type SP = Promise<{ week?: string; view?: string; scope?: string }>;

export default async function ShiftsPage({ searchParams }: { searchParams: SP }) {
  const s = await requireSession();
  if (!s.employeeId) redirect("/admin/today");
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";
  const scope = sp.scope === "team" ? "team" : "me";
  const anchor = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : mondayOf(new Date());

  let start: string, days: number;
  if (view === "week") {
    start = mondayOf(localToUtc(anchor, "12:00"));
    days = 7;
  } else {
    const first = anchor.slice(0, 8) + "01";
    start = mondayOf(localToUtc(first, "12:00"));
    days = 42;
  }
  const from = localToUtc(start, "00:00");
  const to = localToUtc(addDaysStr(start, days), "00:00");
  const shifts = scope === "team" ? await getTeamShifts(s, from, to) : await getMyShifts(s, from, to);
  const byDay: Record<string, typeof shifts> = {};
  for (const sh of shifts) (byDay[localDateStr(sh.startAt)] ??= []).push(sh);
  const todayStr = localDateStr(new Date());
  const step = view === "week" ? 7 : 35;
  const prev = view === "week" ? addDaysStr(start, -7) : addDaysStr(anchor.slice(0, 8) + "01", -1).slice(0, 8) + "01";
  const next = view === "week" ? addDaysStr(start, step) : addDaysStr(anchor.slice(0, 8) + "01", 32).slice(0, 8) + "01";
  const q = (o: Record<string, string>) => "?" + new URLSearchParams({ view, scope, week: anchor, ...o }).toString();
  const totalHours = shifts
    .filter((x) => x.assignments.some((a) => a.employeeId === s.employeeId))
    .reduce((acc, x) => acc + (x.endAt.getTime() - x.startAt.getTime()) / 3.6e6, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{scope === "team" ? ro.shifts.teamShifts : ro.shifts.title}</h1>
          <p className="muted">
            {view === "week" ? `${ro.shifts.calendarWeek} ${fmt(from, "dd.MM")} – ${fmt(new Date(to.getTime() - 1), "dd.MM.yyyy")}` : fmt(localToUtc(anchor.slice(0, 8) + "15", "12:00"), "MMMM yyyy")}
            {" · "}
            {Math.round(totalHours)} {ro.common.hours}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <Link href={q({ scope: "me" })} className={clsx("rounded-md px-3 py-1.5", scope === "me" && "bg-slate-900 text-white")}>{ro.shifts.title}</Link>
            <Link href={q({ scope: "team" })} className={clsx("rounded-md px-3 py-1.5", scope === "team" && "bg-slate-900 text-white")}>{ro.shifts.team}</Link>
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <Link href={q({ view: "week" })} className={clsx("rounded-md px-3 py-1.5", view === "week" && "bg-slate-900 text-white")}>{ro.common.week}</Link>
            <Link href={q({ view: "month" })} className={clsx("rounded-md px-3 py-1.5", view === "month" && "bg-slate-900 text-white")}>{ro.common.month}</Link>
          </div>
          <Link href={q({ week: prev })} className="btn-secondary">‹ {ro.common.previous}</Link>
          <Link href={q({ week: mondayOf(new Date()) })} className="btn-secondary">{ro.common.today}</Link>
          <Link href={q({ week: next })} className="btn-secondary">{ro.common.next} ›</Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
        {ro.daysShort.map((d) => (
          <div key={d} className="bg-slate-50 px-2 py-1.5 text-center text-xs font-medium uppercase text-slate-500">{d}</div>
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = addDaysStr(start, i);
          const list = byDay[day] ?? [];
          const isToday = day === todayStr;
          const outside = view === "month" && day.slice(0, 7) !== anchor.slice(0, 7);
          return (
            <div key={day} className={clsx("bg-white p-1.5", view === "week" ? "min-h-[180px]" : "min-h-[96px]", outside && "bg-slate-50/70 opacity-60")}>
              <div className={clsx("mb-1 text-xs font-medium", isToday ? "inline-block rounded-full bg-brand-600 px-1.5 text-white" : "text-slate-500")}>
                {day.slice(8)}.{day.slice(5, 7)}
              </div>
              <div className="space-y-1">
                {list.map((sh) => {
                  const c = deptColor(sh.department.code);
                  const mine = sh.assignments.find((a) => a.employeeId === s.employeeId);
                  return (
                    <Link key={sh.id} href={`/shifts/${sh.id}`} className={clsx("block rounded-md border-l-4 px-2 py-1 text-xs hover:shadow", c.bg, c.text, c.border, !mine && "opacity-70")}>
                      <div className="flight-board font-semibold">{fmt(sh.startAt, "HH:mm")}–{fmt(sh.endAt, "HH:mm")}</div>
                      {view === "week" && (
                        <>
                          <div className="truncate">{sh.department.name}</div>
                          <div className="truncate text-[11px] opacity-80">{mine?.position?.name ?? `${sh.team?.name ?? ""} · ${sh.assignments.length} pers.`}</div>
                        </>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {shifts.length === 0 && <p className="muted">{ro.shifts.noShifts}</p>}
    </div>
  );
}
