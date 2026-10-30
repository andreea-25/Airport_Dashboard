import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { deptColor } from "@/lib/ui";
import { AddTeam, DepartmentForm, RenameTeam } from "@/components/admin/InlineForms";

export default async function TeamsPage() {
  await requireAdminPage();
  const depts = await prisma.department.findMany({
    orderBy: { name: "asc" },
    include: { teams: { orderBy: { name: "asc" }, include: { employees: { where: { active: true }, include: { level: true } } } } },
  });
  return (
    <div className="space-y-5">
      <h1 className="h1">{ro.admin.teamsTitle}</h1>
      <div className="card card-pad"><DepartmentForm /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {depts.map((d) => (
          <section key={d.id} className="card card-pad space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: deptColor(d.code).hex }} />
              <h2 className="h2">{d.name}</h2>
              <span className="badge bg-slate-100 text-slate-600">{d.code}</span>
            </div>
            <DepartmentForm id={d.id} name={d.name} code={d.code} />
            <ul className="space-y-2">
              {d.teams.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <div className="w-40"><RenameTeam id={t.id} departmentId={d.id} name={t.name} /></div>
                    <span className="text-xs text-slate-500">{t.employees.length} {ro.admin.members}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.employees.sort((a, b) => b.level.rank - a.level.rank).map((e) => (
                      <span key={e.id} className="badge bg-slate-100 text-slate-700" title={e.level.name}>
                        {e.firstName} {e.lastName[0]}. · {e.level.name}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <AddTeam departmentId={d.id} />
          </section>
        ))}
      </div>
    </div>
  );
}
