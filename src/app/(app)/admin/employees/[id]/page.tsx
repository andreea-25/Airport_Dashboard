import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { skillGap } from "@/lib/sim/scenario";
import EmployeeForm from "@/components/admin/EmployeeForm";
import SkillEditor from "@/components/admin/SkillEditor";
import SkillGapView from "@/components/SkillGapView";
import ReadinessPanel from "@/components/team/ReadinessPanel";
import { loadTeamData, panelProps } from "@/lib/team/readiness";

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const e = await prisma.employee.findUnique({ where: { id }, include: { skills: { include: { skill: true }, orderBy: { skill: { name: "asc" } } }, user: true } });
  if (!e) notFound();
  const [departments, teams, levels, skills, gap, teamData] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.level.findMany({ orderBy: { rank: "asc" } }),
    prisma.skill.findMany({ orderBy: { name: "asc" } }),
    skillGap(id),
    loadTeamData(),
  ]);
  const panel = panelProps(teamData, id, 30);
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  return (
    <div className="space-y-5">
      <Link href="/admin/employees" className="text-sm text-brand-600 hover:underline">‹ {ro.admin.employeesTitle}</Link>
      <h1 className="h1">{e.firstName} {e.lastName} {!e.active && <span className="badge bg-slate-200 text-slate-600">{ro.common.inactive}</span>}</h1>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="h2 mb-3">{ro.admin.editEmployee}</h2>
            <EmployeeForm
              employee={{ id: e.id, firstName: e.firstName, lastName: e.lastName, email: e.email, phone: e.phone, departmentId: e.departmentId, teamId: e.teamId, levelId: e.levelId, hireDate: d(e.hireDate)!, contractEndDate: d(e.contractEndDate), active: e.active }}
              departments={departments}
              teams={teams}
              levels={levels}
            />
          </section>
          <section className="card card-pad">
            <h2 className="h2 mb-3">{ro.admin.skillsTitle}</h2>
            <SkillEditor
              employeeId={e.id}
              rows={e.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, type: s.skill.type, proficiency: s.proficiency, obtainedAt: d(s.obtainedAt)!, expiresAt: d(s.expiresAt) }))}
              skills={skills.map((s) => ({ id: s.id, name: s.name, hasExpiry: s.hasExpiry }))}
            />
          </section>
        </div>
        <div className="space-y-5">
          {panel && (
            <section className="card card-pad">
              <h2 className="h2 mb-3">{ro.team.readiness}</h2>
              <ReadinessPanel {...panel} showSolutionsLink />
            </section>
          )}
          <section className="card card-pad h-fit">
            <h2 className="h2 mb-3">{ro.profile.career}</h2>
            <SkillGapView gap={gap} />
          </section>
        </div>
      </div>
    </div>
  );
}
