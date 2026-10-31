import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadTeamData, roDate } from "@/lib/team/readiness";
import { expiredCerts, LEAVE_REASONS, rehireAnalysis } from "@/lib/team/rehire";
import { READINESS_STYLES } from "@/lib/ui";
import RehireForm from "@/components/team/RehireForm";

export const dynamic = "force-dynamic";

export default async function FormerEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const f = await prisma.employee.findUnique({ where: { id }, include: { skills: { include: { skill: true } }, level: true, department: true, team: true } });
  if (!f) notFound();
  if (f.active)
    return (
      <div className="card card-pad text-sm">
        {f.firstName} {f.lastName} e angajat activ.{" "}
        <Link className="text-brand-600 hover:underline" href={`/admin/employees/${f.id}`}>
          Vezi fișa
        </Link>
      </div>
    );
  const data = await loadTeamData();
  const a = rehireAnalysis(data, f, 60);
  const exp = expiredCerts(f);
  const ds = (x: Date) => x.toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <Link href="/admin/candidates?view=former" className="text-sm text-brand-600 hover:underline">
        ‹ Foști angajați
      </Link>
      <div className="card card-pad flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="h1">
            {f.firstName} {f.lastName}
          </h1>
          <p className="muted">
            Fost {f.level.name} · {f.department.name}
            {f.team ? `, ${f.team.name}` : ""} · angajat din {roDate(ds(f.hireDate))}
          </p>
          <p className="mt-2 text-sm">
            A plecat pe <b>{f.leftAt ? roDate(ds(f.leftAt)) : "—"}</b> ({(LEAVE_REASONS[f.leaveReason ?? "OTHER"] ?? f.leaveReason)?.toLowerCase()})
            {f.leaveNote ? ` — ${f.leaveNote}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-600">Competențe: {f.skills.map((s) => `${s.skill.name} ${s.proficiency}`).join(", ")}</p>
          {exp.length > 0 && <p className="mt-1 text-sm text-amber-800">Certificări expirate (trebuie reînnoite): {exp.join(", ")}</p>}
        </div>
        <span className={clsx("rounded-full border px-3 py-1 text-sm font-medium", f.rehireEligible ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800")}>
          {f.rehireEligible ? "Eligibil pentru reangajare" : "Neeligibil pentru reangajare"}
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <section className="card card-pad h-fit">
          <h2 className="h2 mb-1">Simulează reangajarea</h2>
          <p className="muted mb-3">Alegi unde ar reveni; se creează un scenariu în Simulare (programul real nu se schimbă).</p>
          {!f.rehireEligible && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">Atenție: persoana e marcată ca neeligibilă. Poți simula, dar verifică motivul înainte.</p>}
          <RehireForm
            employeeId={f.id}
            suggested={a.suggested}
            depts={a.depts.map((d) => ({
              id: d.departmentId,
              name: d.name,
              previous: d.previous,
              teams: d.teams,
              suggestedTeamId: d.suggestedTeamId,
              readyBy: d.readyBy,
              trainingDays: d.trainingDays,
              before: d.before,
              after: d.after,
            }))}
          />
          <p className="mt-3 text-xs text-slate-500">
            Ca să-l reangajezi de-adevăratelea:{" "}
            <Link className="text-brand-600 hover:underline" href={`/admin/employees/${f.id}`}>
              fișa angajatului → Activează
            </Link>
            .
          </p>
        </section>

        <section className="card card-pad">
          <h2 className="h2 mb-1">Unde ar ajuta cel mai mult</h2>
          <p className="muted mb-3">Efectul pe semafor (60 de zile): câți oameni are departamentul față de necesar, acum și dacă revine.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {a.depts.slice(0, 8).map((d) => (
              <li key={d.departmentId} className="flex items-start gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {d.name}
                    {d.previous && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">fostul departament</span>}
                    {d.departmentId === a.suggested && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-xs text-emerald-800">recomandat</span>}
                  </div>
                  <div className="text-xs text-slate-600">
                    {d.position}: {d.trainingDays === 0 ? "poate începe direct" : `${d.trainingDays} zile (${d.missing}) → gata pe ${roDate(d.readyBy)}`}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <span className={clsx("rounded-full border px-2 py-0.5", READINESS_STYLES[d.before.status].chip)}>{d.before.margin >= 0 ? `+${d.before.margin}` : d.before.margin}</span>
                  →
                  <span className={clsx("rounded-full border px-2 py-0.5", READINESS_STYLES[d.after.status].chip)}>{d.after.margin >= 0 ? `+${d.after.margin}` : d.after.margin}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
