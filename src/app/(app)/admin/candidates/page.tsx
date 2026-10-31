import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { ro } from "@/lib/i18n/ro";
import { computeAll, loadTeamData, roDate } from "@/lib/team/readiness";
import { expiredCerts, LEAVE_REASONS, loadFormerEmployees } from "@/lib/team/rehire";
import { loadProjects, PROJECT_STATUSES, PROJECT_TYPES, suggestProjects } from "@/lib/team/projects";
import { deptColor, READINESS_STYLES } from "@/lib/ui";
import SuggestProjectButton from "@/components/team/SuggestProjectButton";

export const dynamic = "force-dynamic";
const STATUSES = ["NEW", "CONTACTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
type SP = { view?: string; status?: string; dept?: string; project?: string; eligible?: string };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const view = sp.view === "former" ? "former" : sp.view === "projects" ? "projects" : "candidates";
  const [data, former, projects] = await Promise.all([loadTeamData(), loadFormerEmployees(), loadProjects()]);

  const q = (o: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const tab = (v: string, label: string, n: number) => (
    <Link
      href={q({ view: v === "candidates" ? undefined : v })}
      className={clsx("rounded-md px-3 py-1.5 text-sm", view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
    >
      {label} <span className={clsx("ml-1 text-xs", view === v ? "text-slate-300" : "text-slate-400")}>{n}</span>
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{ro.team.candidates}</h1>
          <p className="muted">Posibili angajați: studenți și absolvenți cunoscuți la facultăți, prezentări și concursuri, plus foști angajați.</p>
        </div>
        <div className="flex gap-2">
          {view === "projects" ? (
            <Link href="/admin/candidates/projects/new" className="btn-primary">
              Adaugă proiect
            </Link>
          ) : (
            <Link href="/admin/candidates/new" className="btn-primary">
              Adaugă candidat
            </Link>
          )}
        </div>
      </div>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {tab("candidates", "Candidați", data.candidates.length)}
        {tab("former", "Foști angajați", former.length)}
        {tab("projects", "Proiecte propuse", projects.length)}
      </div>

      {view === "candidates" && <CandidatesView sp={sp} data={data} projects={projects} q={q} formerCount={former.length} />}
      {view === "former" && <FormerView sp={sp} former={former} data={data} q={q} />}
      {view === "projects" && <ProjectsView data={data} projects={projects} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ candidates
function CandidatesView({
  sp,
  data,
  projects,
  q,
  formerCount,
}: {
  sp: SP;
  data: Awaited<ReturnType<typeof loadTeamData>>;
  projects: Awaited<ReturnType<typeof loadProjects>>;
  q: (o: SP) => string;
  formerCount: number;
}) {
  const { balance } = computeAll(data, 60);
  const list = data.candidates.filter(
    (c) => (!sp.status || c.status === sp.status) && (!sp.dept || c.interests.includes(sp.dept)) && (!sp.project || c.projectId === sp.project),
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.candidates.filter((c) => c.status === s).length]));
  const needing = balance.filter((b) => b.margin < 0 || b.status === "RED");
  const projectTitle = (id: string | null) => projects.find((p) => p.id === id)?.title;
  const chip = (active: boolean) => clsx("rounded-full border px-3 py-1", active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white");
  return (
    <>
      {needing.length > 0 && (
        <div className="card card-pad text-sm">
          <span className="font-medium">Departamente care vor avea nevoie de oameni (60 de zile): </span>
          {needing.map((b) => (
            <Link key={b.id} href={q({ ...sp, dept: b.code })} className={clsx("mr-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", READINESS_STYLES[b.status].chip)}>
              {b.name} ({b.margin >= 0 ? `+${b.margin}` : b.margin})
            </Link>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={q({ dept: sp.dept, project: sp.project })} className={chip(!sp.status)}>
          Toți ({data.candidates.length})
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={q({ status: s, dept: sp.dept, project: sp.project })} className={chip(sp.status === s)}>
            {ro.team.candidateStatuses[s]} ({counts[s]})
          </Link>
        ))}
        <Link href={q({ view: "former" })} className={chip(false)}>
          Foști angajați ({formerCount}) ›
        </Link>
        {sp.dept && (
          <Link href={q({ status: sp.status, project: sp.project })} className="rounded-full border border-slate-300 bg-white px-3 py-1">
            interes: {sp.dept} ✕
          </Link>
        )}
        {sp.project && (
          <Link href={q({ status: sp.status, dept: sp.dept })} className="rounded-full border border-slate-300 bg-white px-3 py-1">
            proiect: {projectTitle(sp.project)} ✕
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nume</th>
              <th className="px-4 py-2">Facultate / școală</th>
              <th className="px-4 py-2">Unde l-am cunoscut</th>
              <th className="px-4 py-2">Interese</th>
              <th className="px-4 py-2">Competențe</th>
              <th className="px-4 py-2">Disponibil din</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-slate-500">
                  {ro.common.noData}
                </td>
              </tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/candidates/${c.id}`} className="text-brand-700 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {c.university}
                  <div className="text-xs text-slate-500">
                    {c.specialization} · {c.studyYear}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {c.projectId ? (
                    <Link href={`/admin/candidates/projects/${c.projectId}`} className="text-brand-700 hover:underline">
                      {c.event}
                    </Link>
                  ) : (
                    c.event
                  )}
                  {c.eventDate && <div className="text-xs text-slate-500">{roDate(c.eventDate.toISOString().slice(0, 10))}</div>}
                </td>
                <td className="px-4 py-2">
                  {c.interests.map((code) => (
                    <span key={code} className={clsx("mr-1 rounded px-1.5 py-0.5 text-xs", deptColor(code).bg, deptColor(code).text)}>
                      {code}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">{c.skills.map((s) => `${data.skillById.get(s.skillId)?.code} ${s.proficiency}`).join(", ") || "—"}</td>
                <td className="px-4 py-2">{c.availableFrom ? roDate(c.availableFrom.toISOString().slice(0, 10)) : "—"}</td>
                <td className="px-4 py-2">{ro.team.candidateStatuses[c.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------ former employees
function FormerView({
  sp,
  former,
  data,
  q,
}: {
  sp: SP;
  former: Awaited<ReturnType<typeof loadFormerEmployees>>;
  data: Awaited<ReturnType<typeof loadTeamData>>;
  q: (o: SP) => string;
}) {
  const { balance } = computeAll(data, 60);
  const list = former.filter((f) => (!sp.eligible || (sp.eligible === "1" ? f.rehireEligible : !f.rehireEligible)) && (!sp.dept || f.department.code === sp.dept));
  const chip = (active: boolean) => clsx("rounded-full border px-3 py-1", active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white");
  return (
    <>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={q({ view: "former", dept: sp.dept })} className={chip(!sp.eligible)}>
          Toți ({former.length})
        </Link>
        <Link href={q({ view: "former", eligible: "1", dept: sp.dept })} className={chip(sp.eligible === "1")}>
          Eligibili pentru reangajare ({former.filter((f) => f.rehireEligible).length})
        </Link>
        <Link href={q({ view: "former", eligible: "0", dept: sp.dept })} className={chip(sp.eligible === "0")}>
          Neeligibili ({former.filter((f) => !f.rehireEligible).length})
        </Link>
        {sp.dept && (
          <Link href={q({ view: "former", eligible: sp.eligible })} className="rounded-full border border-slate-300 bg-white px-3 py-1">
            departament: {sp.dept} ✕
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nume</th>
              <th className="px-4 py-2">A lucrat la</th>
              <th className="px-4 py-2">Plecat pe</th>
              <th className="px-4 py-2">Motiv</th>
              <th className="px-4 py-2">Certificări expirate</th>
              <th className="px-4 py-2">Departamentul acum</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-slate-500">
                  Niciun fost angajat. Când dezactivezi pe cineva din fișa lui, apare aici.
                </td>
              </tr>
            )}
            {list.map((f) => {
              const b = balance.find((x) => x.id === f.departmentId);
              const exp = expiredCerts(f);
              return (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">
                    {f.firstName} {f.lastName}
                    {!f.rehireEligible && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-normal text-red-700">neeligibil</span>}
                    {f.leaveNote && <div className="text-xs font-normal text-slate-500">{f.leaveNote}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={q({ view: "former", eligible: sp.eligible, dept: f.department.code })} className={clsx("rounded px-1.5 py-0.5 text-xs", deptColor(f.department.code).bg, deptColor(f.department.code).text)}>
                      {f.department.code}
                    </Link>{" "}
                    {f.level.name}
                    {f.team ? `, ${f.team.name}` : ""}
                  </td>
                  <td className="px-4 py-2">{f.leftAt ? roDate(f.leftAt.toISOString().slice(0, 10)) : "—"}</td>
                  <td className="px-4 py-2">{LEAVE_REASONS[f.leaveReason ?? "OTHER"] ?? f.leaveReason}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{exp.length ? exp.join(", ") : "—"}</td>
                  <td className="px-4 py-2">
                    {b && (
                      <span className={clsx("rounded-full border px-2 py-0.5 text-xs", READINESS_STYLES[b.status].chip)}>
                        {b.margin >= 0 ? `+${b.margin}` : b.margin} față de necesar
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/candidates/former/${f.id}`} className={f.rehireEligible ? "btn-secondary btn-sm" : "btn-ghost btn-sm"}>
                      Simulează reangajarea
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------ recruiting projects
function ProjectsView({ data, projects }: { data: Awaited<ReturnType<typeof loadTeamData>>; projects: Awaited<ReturnType<typeof loadProjects>> }) {
  const suggestions = suggestProjects(data, projects);
  const groups = [
    { title: "În desfășurare și planificate", items: projects.filter((p) => ["ONGOING", "PLANNED"].includes(p.status)) },
    { title: "Propuse", items: projects.filter((p) => p.status === "PROPOSED") },
    { title: "Încheiate", items: projects.filter((p) => p.status === "DONE") },
    { title: "Anulate", items: projects.filter((p) => p.status === "CANCELLED") },
  ].filter((g) => g.items.length);
  const done = projects.filter((p) => p.status === "DONE");
  const total = {
    candidates: done.reduce((a, p) => a + p.stats.candidates, 0),
    hired: done.reduce((a, p) => a + p.stats.hired, 0),
    inProgress: projects.reduce((a, p) => a + p.stats.inProgress, 0),
  };
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-pad">
          <div className="text-2xl font-semibold">{total.candidates}</div>
          <div className="muted">candidați din proiectele încheiate</div>
        </div>
        <div className="card card-pad">
          <div className="text-2xl font-semibold">{total.inProgress}</div>
          <div className="muted">în discuții acum (contactați, interviu, ofertă)</div>
        </div>
        <div className="card card-pad">
          <div className="text-2xl font-semibold">{total.hired}</div>
          <div className="muted">angajați prin proiecte</div>
        </div>
      </div>

      <section className="card card-pad">
        <h2 className="h2">Sugestii de proiecte</h2>
        <p className="muted mb-3">
          Pentru departamentele care vor avea lipsă de oameni în 60 de zile sau competențe critice și care nu au deja un proiect în curs. Facultăți și școli din Craiova, plus școli de aviație acolo unde în Craiova nu există specializarea.
        </p>
        {suggestions.length === 0 && <p className="text-sm text-slate-500">Toate departamentele cu probleme au deja un proiect propus sau în curs.</p>}
        <ul className="divide-y divide-slate-100">
          {suggestions.map((s) => (
            <li key={s.deptCode} className="flex flex-wrap items-start gap-3 py-3">
              <span className={clsx("mt-0.5 rounded px-1.5 py-0.5 text-xs", deptColor(s.deptCode).bg, deptColor(s.deptCode).text)}>{s.deptCode}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">
                  {s.title} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">{PROJECT_TYPES[s.type]}</span>
                </div>
                <div className="text-slate-600">{s.institution}</div>
                <div className="text-xs text-slate-500">
                  De ce: {s.reason}; {s.why}.{s.history ? ` Istoric: ${s.history}.` : ""}
                </div>
              </div>
              <SuggestProjectButton suggestion={{ title: s.title, type: s.type, institution: s.institution, deptCode: s.deptCode, reach: s.reach, why: `${s.reason}; ${s.why}` }} />
            </li>
          ))}
        </ul>
      </section>

      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="h2">{g.title}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((p) => (
              <Link key={p.id} href={`/admin/candidates/projects/${p.id}`} className="card card-pad block transition hover:shadow-md">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{PROJECT_TYPES[p.type]}</span>
                  <span className="text-slate-500">{PROJECT_STATUSES[p.status]}</span>
                  <span className="ml-auto text-slate-500">
                    {p.startDate ? roDate(p.startDate.toISOString().slice(0, 10)) : "dată nestabilită"}
                    {p.endDate ? ` – ${roDate(p.endDate.toISOString().slice(0, 10))}` : ""}
                  </span>
                </div>
                <div className="mt-2 font-medium">{p.title}</div>
                <div className="text-sm text-slate-600">{p.institution}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.targetDepartments.map((code) => (
                    <span key={code} className={clsx("rounded px-1.5 py-0.5 text-xs", deptColor(code).bg, deptColor(code).text)}>
                      {code}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-4 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  <span>
                    <b className="text-slate-900">{p.stats.candidates}</b> candidați
                  </span>
                  <span>
                    <b className="text-slate-900">{p.stats.inProgress}</b> în discuții
                  </span>
                  <span>
                    <b className="text-slate-900">{p.stats.hired}</b> angajați
                  </span>
                  {p.expectedReach ? <span className="ml-auto">~{p.expectedReach} participanți</span> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
