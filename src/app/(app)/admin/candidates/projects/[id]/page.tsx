import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { roDate } from "@/lib/team/readiness";
import ProjectForm from "@/components/team/ProjectForm";

export const dynamic = "force-dynamic";
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const isNew = id === "new";
  const [p, departments] = await Promise.all([
    isNew ? null : prisma.recruitingProject.findUnique({ where: { id }, include: { candidates: { orderBy: { lastName: "asc" } } } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!isNew && !p) notFound();
  const stats = p
    ? {
        total: p.candidates.length,
        inProgress: p.candidates.filter((c) => ["CONTACTED", "INTERVIEW", "OFFER"].includes(c.status)).length,
        hired: p.candidates.filter((c) => c.status === "HIRED").length,
      }
    : null;

  return (
    <div className="space-y-5">
      <Link href="/admin/candidates?view=projects" className="text-sm text-brand-600 hover:underline">
        ‹ Proiecte propuse
      </Link>
      <h1 className="h1">{p ? p.title : "Proiect nou"}</h1>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="card card-pad">
          <ProjectForm
            project={
              p
                ? {
                    id: p.id,
                    title: p.title,
                    type: p.type,
                    institution: p.institution,
                    targetDepartments: p.targetDepartments,
                    startDate: d(p.startDate),
                    endDate: d(p.endDate),
                    status: p.status,
                    description: p.description ?? "",
                    expectedReach: p.expectedReach ? String(p.expectedReach) : "",
                  }
                : undefined
            }
            departments={departments.map((x) => ({ id: x.id, name: x.name, code: x.code }))}
          />
        </section>
        {p && stats && (
          <section className="card card-pad h-fit">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="h2">Candidați din acest proiect</h2>
              <Link href={`/admin/candidates/new?project=${p.id}`} className="btn-secondary btn-sm">
                Adaugă candidat
              </Link>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xl font-semibold">{stats.total}</div>
                <div className="text-xs text-slate-500">candidați</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xl font-semibold">{stats.inProgress}</div>
                <div className="text-xs text-slate-500">în discuții</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2">
                <div className="text-xl font-semibold text-emerald-800">{stats.hired}</div>
                <div className="text-xs text-emerald-800">angajați</div>
              </div>
            </div>
            {p.expectedReach ? (
              <p className="mb-2 text-xs text-slate-500">
                Rată de conversie: {stats.total} din ~{p.expectedReach} participanți ({Math.round((stats.total / p.expectedReach) * 100)}%)
              </p>
            ) : null}
            <ul className="divide-y divide-slate-100 text-sm">
              {p.candidates.length === 0 && <li className="py-2 text-slate-500">Niciun candidat încă.</li>}
              {p.candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <Link href={`/admin/candidates/${c.id}`} className="text-brand-700 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {c.specialization} · {ro.team.candidateStatuses[c.status]}
                  </span>
                </li>
              ))}
            </ul>
            {p.startDate && <p className="mt-3 text-xs text-slate-400">Început: {roDate(d(p.startDate))}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
