import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { loadTeamData } from "@/lib/team/readiness";
import { candidateMatches } from "@/lib/team/replacement";
import { READINESS_STYLES } from "@/lib/ui";
import CandidateForm from "@/components/team/CandidateForm";
import CandidateSkills from "@/components/team/CandidateSkills";
import CandidateStatus from "@/components/team/CandidateStatus";
import HireForm from "@/components/team/HireForm";

export const dynamic = "force-dynamic";
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const isNew = id === "new";
  const [c, departments, teams, levels, skills] = await Promise.all([
    isNew ? null : prisma.candidate.findUnique({ where: { id }, include: { skills: { include: { skill: true } }, hiredEmployee: true } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.level.findMany({ orderBy: { rank: "asc" } }),
    prisma.skill.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!isNew && !c) notFound();
  const matches = c ? candidateMatches(await loadTeamData(), c.id, 60) : [];
  const deptOpts = departments.map((x) => ({ id: x.id, name: x.name, code: x.code }));

  return (
    <div className="space-y-5">
      <Link href="/admin/candidates" className="text-sm text-brand-600 hover:underline">
        ‹ {ro.team.candidates}
      </Link>
      <h1 className="h1">{c ? `${c.firstName} ${c.lastName}` : "Candidat nou"}</h1>
      {c && <CandidateStatus id={c.id} status={c.status} hiredEmployee={c.hiredEmployee ? { id: c.hiredEmployee.id, name: `${c.hiredEmployee.firstName} ${c.hiredEmployee.lastName}` } : null} />}
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="h2 mb-3">Date candidat</h2>
            <CandidateForm
              candidate={
                c
                  ? {
                      id: c.id,
                      firstName: c.firstName,
                      lastName: c.lastName,
                      email: c.email,
                      phone: c.phone ?? "",
                      university: c.university,
                      specialization: c.specialization,
                      studyYear: c.studyYear,
                      event: c.event,
                      eventDate: d(c.eventDate),
                      interests: c.interests,
                      availableFrom: d(c.availableFrom),
                      notes: c.notes ?? "",
                      consent: !!c.consentAt,
                    }
                  : undefined
              }
              departments={deptOpts}
            />
          </section>
          {c && (
            <section className="card card-pad">
              <h2 className="h2 mb-3">Competențe și certificări</h2>
              <CandidateSkills
                candidateId={c.id}
                rows={c.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, type: s.skill.type, proficiency: s.proficiency, expiresAt: d(s.expiresAt) || null }))}
                skills={skills.map((s) => ({ id: s.id, name: s.name, hasExpiry: s.hasExpiry }))}
              />
            </section>
          )}
        </div>
        {c && (
          <div className="space-y-5">
            <section className="card card-pad">
              <h2 className="h2 mb-1">Unde s-ar potrivi</h2>
              <p className="muted mb-3">Cel mai apropiat post din fiecare departament și cât durează pregătirea; departamentele cu lipsă de oameni în 60 de zile sunt marcate.</p>
              <ul className="divide-y divide-slate-100 text-sm">
                {matches.slice(0, 8).map((m) => (
                  <li key={m.departmentId} className="flex items-start gap-2 py-2">
                    <span className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", READINESS_STYLES[m.status].dot)} />
                    <div className="flex-1">
                      <div className="font-medium">
                        {m.name} {m.interested && <span className="ml-1 rounded bg-emerald-50 px-1.5 text-xs text-emerald-800">interesat</span>}
                      </div>
                      <div className="text-xs text-slate-600">
                        {m.position}: {m.trainingDays === 0 ? "poate începe direct" : `${m.trainingDays} zile de pregătire — ${m.missing}`}
                      </div>
                    </div>
                    <span className={clsx("text-xs", m.margin < 0 ? "text-red-700" : "text-slate-500")}>{m.margin >= 0 ? `+${m.margin}` : m.margin}</span>
                  </li>
                ))}
              </ul>
            </section>
            {c.status !== "HIRED" && (
              <section className="card card-pad">
                <h2 className="h2 mb-3">{ro.team.hire}</h2>
                <HireForm
                  candidateId={c.id}
                  departments={deptOpts}
                  teams={teams}
                  levels={levels}
                  defaultDepartmentId={matches[0]?.departmentId ?? departments[0]?.id}
                  defaultDate={d(c.availableFrom) || new Date().toISOString().slice(0, 10)}
                />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
