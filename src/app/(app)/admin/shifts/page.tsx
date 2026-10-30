import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { addDaysStr, fmt, localDateStr, localHour, localIsoDow, localToUtc, mondayOf } from "@/lib/time";
import ShiftManager from "@/components/admin/ShiftManager";

type SP = Promise<{ dept?: string; week?: string }>;

export default async function AdminShiftsPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage();
  const sp = await searchParams;
  const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
  const dept = departments.find((d) => d.id === sp.dept) ?? departments.find((d) => d.code === "SEC") ?? departments[0];
  const monday = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? mondayOf(localToUtc(sp.week, "12:00")) : mondayOf(new Date());
  const from = localToUtc(monday, "00:00");
  const to = localToUtc(addDaysStr(monday, 7), "00:00");
  const [shifts, teams, employees, positions, templates, staffing] = await Promise.all([
    prisma.shift.findMany({
      where: { departmentId: dept.id, startAt: { gte: from, lt: to } },
      include: { team: true, assignments: { include: { employee: { include: { level: true, skills: true } }, position: { include: { skills: { include: { skill: true } } } } } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.team.findMany({ where: { departmentId: dept.id }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { active: true, departmentId: dept.id }, include: { team: true }, orderBy: { lastName: "asc" } }),
    prisma.position.findMany({ where: { departmentId: dept.id } }),
    prisma.shiftTemplate.findMany({ orderBy: { startTime: "asc" } }),
    prisma.staffingRequirement.findMany({ where: { departmentId: dept.id } }),
  ]);
  const required = (start: Date, end: Date) => {
    const dow = localIsoDow(start);
    let max = 0;
    for (let t = start.getTime(); t < end.getTime(); t += 3.6e6) {
      const h = localHour(new Date(t));
      for (const r of staffing) if (r.dayOfWeek === dow && h >= r.startHour && h < r.endHour) max = Math.max(max, r.minStaff);
    }
    return max;
  };
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysStr(monday, i);
    return { date, label: `${ro.daysShort[i]} ${date.slice(8)}.${date.slice(5, 7)}` };
  });
  const link = (o: Record<string, string>) => "?" + new URLSearchParams({ dept: dept.id, week: monday, ...o });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{ro.admin.shiftsTitle}</h1>
          <p className="muted">{fmt(from, "dd.MM")} – {fmt(new Date(to.getTime() - 1), "dd.MM.yyyy")}</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={link({ week: addDaysStr(monday, -7) })}>‹</Link>
          <Link className="btn-secondary" href={link({ week: mondayOf(new Date()) })}>{ro.common.today}</Link>
          <Link className="btn-secondary" href={link({ week: addDaysStr(monday, 7) })}>›</Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => (
          <Link key={d.id} href={link({ dept: d.id })} className={`badge px-3 py-1 ${d.id === dept.id ? "bg-slate-900 text-white" : "border bg-white"}`}>{d.name}</Link>
        ))}
      </div>
      <ShiftManager
        key={`${dept.id}${monday}`}
        departmentId={dept.id}
        monday={monday}
        days={days}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        employees={employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}`, teamName: e.team?.name ?? null }))}
        positions={positions.map((p) => ({ id: p.id, name: p.name }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, start: t.startTime, end: t.endTime }))}
        shifts={shifts.map((s) => ({
          id: s.id,
          date: localDateStr(s.startAt),
          start: fmt(s.startAt, "HH:mm"),
          end: fmt(s.endAt, "HH:mm"),
          teamId: s.teamId,
          teamName: s.team?.name ?? null,
          required: required(s.startAt, s.endAt),
          assignments: s.assignments.map((a) => ({
            id: a.id,
            employeeId: a.employeeId,
            name: `${a.employee.lastName} ${a.employee.firstName}`,
            level: a.employee.level.name,
            rank: a.employee.level.rank,
            positionId: a.positionId,
            isLead: a.isLead,
            missing: (a.position?.skills ?? [])
              .filter((ps) => {
                const h = a.employee.skills.find((x) => x.skillId === ps.skillId);
                return !h || h.proficiency < ps.minProficiency || (h.expiresAt && h.expiresAt < s.startAt);
              })
              .map((ps) => ps.skill.name),
          })),
        }))}
      />
    </div>
  );
}
