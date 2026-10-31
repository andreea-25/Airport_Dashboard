import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { computeAll, HORIZONS, loadTeamData, type Color } from "@/lib/team/readiness";
import { deptColor, READINESS_STYLES } from "@/lib/ui";
import WhatIfForm from "@/components/team/WhatIfForm";

export const dynamic = "force-dynamic";

const CAND_STATUS: Record<string, string> = { NEW: "Nou", CONTACTED: "Contactat", INTERVIEW: "Interviu", OFFER: "Ofertă", HIRED: "Angajat", REJECTED: "Respins" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ h?: string; dept?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const horizon = HORIZONS.find((h) => String(h) === sp.h) ?? 30;
  const data = await loadTeamData();
  const { readiness, balance } = computeAll(data, horizon);
  const deptFilter = data.departments.find((d) => d.code === sp.dept);
  const totals: Record<Color, number> = { GREEN: 0, ORANGE: 0, RED: 0 };
  for (const r of readiness.values()) totals[r.color]++;
  const watch = data.employees
    .filter((e) => (!deptFilter || e.departmentId === deptFilter.id) && readiness.get(e.id)!.color !== "GREEN")
    .sort((a, b) => (readiness.get(b.id)!.color === "RED" ? 1 : 0) - (readiness.get(a.id)!.color === "RED" ? 1 : 0));
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? "";
  const short = new Set(balance.filter((b) => b.margin < 0 || b.status === "RED").map((b) => b.code));
  const pool = data.candidates
    .filter((c) => !["HIRED", "REJECTED"].includes(c.status) && c.interests.some((i) => short.has(i) && (!deptFilter || i === deptFilter.code)))
    .slice(0, 6);
  const q = (h: number, dept?: string) => `?h=${h}${dept ? `&dept=${dept}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Echipa</h1>
          <p className="muted">Pe cine te poți baza în următoarele {horizon} de zile și unde se dezechilibrează echipa.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {HORIZONS.map((h) => (
            <Link key={h} href={q(h, sp.dept)} className={clsx("rounded-md px-3 py-1.5 text-sm", h === horizon ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {h} zile
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["GREEN", "ORANGE", "RED"] as Color[]).map((c) => (
          <div key={c} className="card card-pad flex items-center gap-3">
            <span className={clsx("h-4 w-4 rounded-full", READINESS_STYLES[c].dot)} />
            <div>
              <div className="text-2xl font-semibold">{totals[c]}</div>
              <div className="muted">
                {c === "GREEN" ? "Verde — fără impedimente" : c === "ORANGE" ? "Portocaliu — de urmărit" : "Roșu — nu te poți baza"}
              </div>
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="h2 mb-3">Echilibrul pe departamente</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {balance.map((b) => {
            const c = deptColor(b.code);
            const all = b.total || 1;
            return (
              <Link key={b.id} href={q(horizon, b.code)} className={clsx("card overflow-hidden transition hover:shadow-md", deptFilter?.id === b.id && "ring-2 ring-slate-900")}>
                <div className={clsx("flex items-center justify-between border-l-4 px-4 py-2.5", c.border, c.bg)}>
                  <span className={clsx("text-sm font-semibold", c.text)}>{b.name}</span>
                  <span className={clsx("rounded-full border px-2 py-0.5 text-xs font-medium", READINESS_STYLES[b.status].chip)}>{READINESS_STYLES[b.status].label}</span>
                </div>
                <div className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                    {(["GREEN", "ORANGE", "RED"] as Color[]).map((k) => (
                      <div key={k} className={READINESS_STYLES[k].dot} style={{ width: `${(b.counts[k] / all) * 100}%` }} />
                    ))}
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>
                      {b.counts.GREEN} verde · {b.counts.ORANGE} portocaliu · {b.counts.RED} roșu
                    </span>
                    <span className={clsx("font-medium", b.margin < 0 ? "text-red-700" : b.margin === 0 ? "text-amber-700" : "text-emerald-700")}>
                      {b.counts.GREEN + b.counts.ORANGE}/{b.required} necesar
                    </span>
                  </div>
                  {b.critical.length > 0 && (
                    <div className="text-xs text-slate-600">
                      Competențe critice:{" "}
                      {b.critical.map((k) => (
                        <span key={k.skillId} className="mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
                          {k.name} {k.greenHolders}/{k.needed}
                        </span>
                      ))}
                    </div>
                  )}
                  {b.teams.some((t) => !t.hasLead) && (
                    <div className="text-xs text-red-700">Fără șef de tură disponibil: {b.teams.filter((t) => !t.hasLead).map((t) => t.name).join(", ")}</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="h2">Ce-ar fi dacă…</h2>
        <p className="muted mb-3">Simulează o plecare sau o absență (fără să salvezi nimic) și vezi ce soluții ai.</p>
        <WhatIfForm
          horizon={horizon}
          employees={data.employees.map((e) => ({ id: e.id, name: e.name, level: e.levelName, dept: deptName(e.departmentId) }))}
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="h2">De urmărit{deptFilter ? ` — ${deptFilter.name}` : ""}</h2>
          {deptFilter && (
            <Link href={q(horizon)} className="text-sm text-slate-500 hover:underline">
              toate departamentele
            </Link>
          )}
        </div>
        <ul className="divide-y divide-slate-100">
          {watch.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">Toată lumea e pe verde.</li>}
          {watch.map((e) => {
            const r = readiness.get(e.id)!;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={clsx("h-3 w-3 shrink-0 rounded-full", READINESS_STYLES[r.color].dot)} title={READINESS_STYLES[r.color].label} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {e.name} <span className="font-normal text-slate-500">· {e.levelName} · {deptName(e.departmentId)}{e.teamName ? `, ${e.teamName}` : ""}</span>
                  </div>
                  <div className="text-xs text-slate-600">{r.reasons.map((x) => x.text).join(" · ")}</div>
                </div>
                <Link href={`/admin/team/${e.id}?h=${horizon}`} className="btn-secondary text-sm">
                  Propune soluții
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="h2">Posibili angajați</h2>
            <p className="muted">Din baza de talente, pentru departamentele cu lipsă de oameni.</p>
          </div>
          <Link href="/admin/candidates" className="btn-secondary btn-sm">
            Toți candidații ›
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {pool.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Niciun candidat activ pentru departamentele cu lipsă.</li>}
          {pool.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <Link href={`/admin/candidates/${c.id}`} className="font-medium text-brand-700 hover:underline">
                {c.firstName} {c.lastName}
              </Link>
              <span className="text-slate-500">
                {c.specialization}, {c.university} · {c.event}
              </span>
              <span className="ml-auto flex gap-1">
                {c.interests.map((code) => (
                  <span key={code} className={clsx("rounded px-1.5 py-0.5 text-xs", deptColor(code).bg, deptColor(code).text)}>
                    {code}
                  </span>
                ))}
              </span>
              <span className="w-20 text-right text-xs text-slate-500">{CAND_STATUS[c.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
