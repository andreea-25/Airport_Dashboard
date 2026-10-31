import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { AVAILABILITY_LABELS, HORIZONS, loadTeamData, panelProps, roDate } from "@/lib/team/readiness";
import ReadinessPanel from "@/components/team/ReadinessPanel";
import ApplySolutionButton from "@/components/team/ApplySolutionButton";
import { proposeReplacements } from "@/lib/team/replacement";
import { READINESS_STYLES } from "@/lib/ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; cls: string }> = {
  RENEW: { label: "Reînnoire", cls: "bg-sky-100 text-sky-800" },
  MOVE: { label: "Mutare internă", cls: "bg-indigo-100 text-indigo-800" },
  EXTEND: { label: "Prelungire + pregătire", cls: "bg-violet-100 text-violet-800" },
  CANDIDATE: { label: "Candidat extern", cls: "bg-teal-100 text-teal-800" },
};
const EXTENSIONS = [15, 30, 60];

export default async function SolutionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ h?: string; ext?: string; what?: string; from?: string; to?: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const sp = await searchParams;
  const horizon = HORIZONS.find((h) => String(h) === sp.h) ?? 30;
  const ext = EXTENSIONS.find((e) => String(e) === sp.ext) ?? 30;
  const data = await loadTeamData();
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const whatIf =
    sp.what && AVAILABILITY_LABELS[sp.what] && sp.from && DATE.test(sp.from) ? { type: sp.what, start: sp.from, end: sp.to && DATE.test(sp.to) ? sp.to : null } : null;
  const res = proposeReplacements(data, id, { horizon, extensionDays: ext, whatIf });
  const keep = (extra: string) => `?h=${horizon}${whatIf ? `&what=${whatIf.type}&from=${whatIf.start}${whatIf.end ? `&to=${whatIf.end}` : ""}` : ""}${extra}`;
  if (!res) notFound();
  const r = res.readiness;
  const panel = panelProps(data, id, horizon);
  const st = READINESS_STYLES[r.color];

  return (
    <div className="space-y-6">
      <Link href={`/admin/team?h=${horizon}`} className="text-sm text-slate-500 hover:underline">
        ‹ Echipa
      </Link>
      {whatIf && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-900">
          <b>Ipoteză:</b> {AVAILABILITY_LABELS[whatIf.type].toLowerCase()} din {roDate(whatIf.start)}
          {whatIf.end ? ` până pe ${roDate(whatIf.end)}` : ""}. Nu s-a salvat nimic în fișa angajatului.{" "}
          <Link href={`?h=${horizon}`} className="underline">
            Renunță la ipoteză
          </Link>
        </div>
      )}
      <div className="card card-pad flex flex-wrap items-start gap-4">
        <span className={clsx("mt-1 h-5 w-5 rounded-full", st.dot)} />
        <div className="min-w-0 flex-1">
          <h1 className="h1">{res.employee.name}</h1>
          <p className="muted">
            {res.employee.level} · {res.employee.department}
            {res.employee.team ? `, ${res.employee.team}` : ""}
            {res.employee.position ? ` · post: ${res.employee.position}` : ""}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className={clsx("inline-block rounded-full border px-3 py-1 font-medium", st.chip)}>{st.label}</div>
          <div className="mt-2 text-slate-600">
            {res.permanent ? "Pleacă din" : r.awayFrom ? "Lipsește din" : "Termen"} <b>{roDate(res.gapFrom)}</b>
            {res.gapTo ? ` până pe ${roDate(res.gapTo)}` : res.permanent ? " (definitiv)" : ""}
          </div>
          <div className={clsx("mt-1", res.departmentMargin < 0 ? "text-red-700" : "text-slate-600")}>
            Departamentul: {res.departmentMargin >= 0 ? `+${res.departmentMargin}` : res.departmentMargin} față de necesar
          </div>
        </div>
      </div>

      {res.permanent && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Prelungire propusă:</span>
          {EXTENSIONS.map((e) => (
            <Link key={e} href={keep(`&ext=${e}`)} className={clsx("rounded-md border px-3 py-1", e === ext ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
              {e} zile
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <section className="space-y-3">
        <h2 className="h2">Propuneri de soluții</h2>
        {res.options.length === 0 && <div className="card card-pad text-sm text-slate-500">Nu am găsit soluții automate.</div>}
        {res.options.map((o, i) => (
          <div key={i} className={clsx("card card-pad", !o.feasible && "opacity-75")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-400">#{i + 1}</span>
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", KIND[o.kind].cls)}>{KIND[o.kind].label}</span>
              <h3 className="flex-1 font-medium">{o.title}</h3>
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", o.feasible ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600")}>
                {o.feasible ? "Fezabil" : "Nu ajunge timpul"}
              </span>
              <span className="text-sm text-slate-500">scor {o.score}</span>
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {o.steps.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ol>
            {o.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {o.warnings.map((w, k) => (
                  <li key={k}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {o.readyBy && o.trainingDays > 0 && <span className="text-xs text-slate-500">Pregătire: {o.trainingDays} zile lucrătoare · gata pe {roDate(o.readyBy)}</span>}
              {o.people.filter((x) => x.kind === "CANDIDATE").map((x) => (
                <Link key={x.id} href={`/admin/candidates/${x.id}`} className="text-xs text-brand-600 hover:underline">
                  fișa candidatului ›
                </Link>
              ))}
              {o.changes.length > 0 && (
                <span className="ml-auto">
                  <ApplySolutionButton employeeId={id} horizon={horizon} extensionDays={ext} optionIndex={i} whatIf={whatIf} />
                </span>
              )}
            </div>
          </div>
        ))}
      </section>
      {panel && (
        <section className="card card-pad h-fit">
          <h2 className="h2 mb-3">Fișa de disponibilitate{whatIf ? " (reală, fără ipoteză)" : ""}</h2>
          <ReadinessPanel {...panel} />
        </section>
      )}
      </div>
    </div>
  );
}
