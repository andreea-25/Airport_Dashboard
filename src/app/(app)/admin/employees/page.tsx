import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import EmployeeForm from "@/components/admin/EmployeeForm";

type SP = Promise<{ q?: string; dept?: string; inactive?: string; add?: string }>;

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage();
  const sp = await searchParams;
  const [departments, teams, levels] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.level.findMany({ orderBy: { rank: "asc" } }),
  ]);
  const q = sp.q?.trim();
  const employees = await prisma.employee.findMany({
    where: {
      ...(sp.dept ? { departmentId: sp.dept } : {}),
      ...(sp.inactive ? {} : { active: true }),
      ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { department: true, team: true, level: true, skills: true },
    orderBy: [{ department: { name: "asc" } }, { lastName: "asc" }],
  });
  const now = Date.now();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{ro.admin.employeesTitle}</h1>
          <p className="muted">{employees.length} {ro.admin.members}</p>
        </div>
        <Link href={sp.add ? "?" : "?add=1"} className="btn-primary">{sp.add ? ro.common.close : `+ ${ro.admin.addEmployee}`}</Link>
      </div>
      {sp.add && (
        <div className="card card-pad">
          <h2 className="h2 mb-3">{ro.admin.addEmployee}</h2>
          <EmployeeForm departments={departments} teams={teams} levels={levels} />
        </div>
      )}
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder={ro.common.search} />
        <select name="dept" defaultValue={sp.dept ?? ""} className="input max-w-xs">
          <option value="">{ro.common.all}</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> {ro.common.inactive}
        </label>
        <button className="btn-secondary">{ro.common.filter}</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{ro.admin.lastName}</th>
              <th>{ro.profile.department}</th>
              <th>{ro.profile.team}</th>
              <th>{ro.profile.level}</th>
              <th>{ro.profile.skills}</th>
              <th>{ro.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const expired = e.skills.filter((s) => s.expiresAt && s.expiresAt.getTime() < now).length;
              const soon = e.skills.filter((s) => s.expiresAt && s.expiresAt.getTime() >= now && s.expiresAt.getTime() < now + 30 * 86400000).length;
              return (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/admin/employees/${e.id}`} className="font-medium text-brand-700 hover:underline">{e.lastName} {e.firstName}</Link>
                    <div className="text-xs text-slate-400">{e.email}</div>
                  </td>
                  <td>{e.department.name}</td>
                  <td>{e.team?.name ?? ro.common.none}</td>
                  <td>{e.level.name}</td>
                  <td>
                    {e.skills.length}
                    {expired > 0 && <span className="badge ml-1 bg-red-100 text-red-800">{expired} {ro.profile.expired.toLowerCase()}</span>}
                    {soon > 0 && <span className="badge ml-1 bg-amber-100 text-amber-900">{soon} {ro.profile.expiresSoon.toLowerCase()}</span>}
                  </td>
                  <td><span className={clsx("badge", e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600")}>{e.active ? ro.common.active : ro.common.inactive}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
