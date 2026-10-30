import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { addDaysStr, fmt, localDateStr, localHour, localIsoDow, localToUtc } from "@/lib/time";
import { evaluateReal } from "@/lib/sim/scenario";
import { deptColor, pctColor } from "@/lib/ui";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : localDateStr(new Date());
  const from = localToUtc(day, "00:00");
  const to = localToUtc(addDaysStr(day, 1), "00:00");
  const now = new Date();

  const [shifts, staffing, depts, evaluation, newRequests, expiring] = await Promise.all([
    prisma.shift.findMany({
      where: { startAt: { gte: from, lt: to } },
      include: { department: true, team: true, assignments: { include: { employee: { include: { level: true } }, position: true } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.staffingRequirement.findMany({ where: { dayOfWeek: localIsoDow(from) } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    evaluateReal(from, to),
    prisma.request.count({ where: { status: "SUBMITTED" } }),
    prisma.employeeSkill.findMany({
      where: { expiresAt: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) }, employee: { active: true } },
      include: { employee: true, skill: true },
      orderBy: { expiresAt: "asc" },
      take: 12,
    }),
  ]);

  // required staff for a shift = peak requirement during its hours
  const requiredFor = (deptId: string, startAt: Date, endAt: Date) => {
    let max = 0;
    for (let t = startAt.getTime(); t < Math.min(endAt.getTime(), to.getTime()); t += 3.6e6) {
      const h = localHour(new Date(t));
      for (const r of staffing) if (r.departmentId === deptId && h >= r.startHour && h < r.endHour) max = Math.max(max, r.minStaff);
    }
    return max;
  };
  const workingNow = shifts.filter((s) => s.startAt <= now && s.endAt > now).reduce((a, s) => a + s.assignments.length, 0);
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{ro.admin.todayTitle}</h1>
          <p className="muted capitalize">{fmt(localToUtc(day, "12:00"), "EEEE, dd MMMM yyyy")}</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={`?date=${addDaysStr(day, -1)}`}>‹</Link>
          <Link className="btn-secondary" href="?">{ro.common.today}</Link>
          <Link className="btn-secondary" href={`?date=${addDaysStr(day, 1)}`}>›</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={ro.admin.workingNow} value={workingNow} />
        <Kpi label={ro.admin.workingToday} value={shifts.length} />
        <Kpi label={ro.sim.avgCoverage} value={`${evaluation.summary.avgCoverage}%`} tone={evaluation.summary.avgCoverage < 95 ? "warn" : "ok"} />
        <Kpi label={ro.admin.newRequests} value={newRequests} href="/admin/requests" tone={newRequests ? "warn" : "ok"} />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {depts.map((d) => {
          const list = shifts.filter((s) => s.departmentId === d.id);
          const c = deptColor(d.code);
          return (
            <div key={d.id} className={clsx("card overflow-hidden")}>
              <div className={clsx("border-l-4 px-4 py-2.5", c.border, c.bg)}>
                <div className={clsx("text-sm font-semibold", c.text)}>{d.name}</div>
              </div>
              <ul className="divide-y divide-slate-100">
                {list.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">{ro.common.noData}</li>}
                {list.map((s) => {
                  const req = requiredFor(d.id, s.startAt, s.endAt);
                  const n = s.assignments.length;
                  const low = n < req;
                  const hasLead = s.assignments.some((a) => a.employee.level.rank >= 3);
                  return (
                    <li key={s.id} className="px-4 py-2.5">
                      <Link href={`/shifts/${s.id}`} className="flex items-center justify-between text-sm hover:underline">
                        <span className="flight-board">{fmt(s.startAt, "HH:mm")}–{fmt(s.endAt, "HH:mm")}</span>
                        <span className={clsx("badge", low ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800")}>
                          {n}/{req} {ro.admin.people}
                        </span>
                      </Link>
                      <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                        <span>{s.team?.name}</span>
                        {!hasLead && <span className="text-red-600">{ro.shifts.noLead}</span>}
                        {low && hasLead && <span className="text-red-600">{ro.admin.belowMin}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="card card-pad overflow-x-auto">
        <h2 className="h2 mb-3">{ro.admin.coverageByHour}</h2>
        <table className="w-full border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th className="w-56 text-left font-medium text-slate-500" />
              {hours.map((h) => (
                <th key={h} className="font-normal text-slate-400">{String(h).padStart(2, "0")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d.id}>
                <td className="pr-2 text-xs text-slate-700">{d.name}</td>
                {hours.map((h) => {
                  const slot = evaluation.coverage.find((c) => c.departmentId === d.id && localHour(new Date(c.slotStart)) === h);
                  if (!slot) return <td key={h} className="h-7 rounded bg-slate-50" />;
                  return (
                    <td key={h} title={`${slot.assigned}/${slot.required}`} className={clsx("h-7 rounded text-center font-medium", pctColor(slot.pct))}>
                      {slot.assigned}/{slot.required}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-pad">
        <h2 className="h2 mb-3">{ro.admin.expiringCerts}</h2>
        {expiring.length === 0 ? (
          <p className="muted">{ro.common.noData}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {expiring.map((e) => (
              <li key={`${e.employeeId}${e.skillId}`} className="rounded-lg bg-amber-50 px-3 py-2 text-sm">
                <Link href={`/admin/employees/${e.employeeId}`} className="font-medium hover:underline">{e.employee.firstName} {e.employee.lastName}</Link>
                <div className="text-xs text-amber-900">{e.skill.name} · {fmt(e.expiresAt!, "dd.MM.yyyy")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, tone, href }: { label: string; value: React.ReactNode; tone?: "ok" | "warn"; href?: string }) {
  const body = (
    <div className={clsx("card card-pad", tone === "warn" && "border-amber-300")}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
