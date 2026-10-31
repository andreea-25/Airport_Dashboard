import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { ro } from "@/lib/i18n/ro";
import { computeAll, loadTeamData, roDate } from "@/lib/team/readiness";
import { deptColor, READINESS_STYLES } from "@/lib/ui";

export const dynamic = "force-dynamic";
const STATUSES = ["NEW", "CONTACTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ status?: string; dept?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const data = await loadTeamData();
  const { balance } = computeAll(data, 60);
  const list = data.candidates.filter((c) => (!sp.status || c.status === sp.status) && (!sp.dept || c.interests.includes(sp.dept)));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.candidates.filter((c) => c.status === s).length]));
  // departments that will need people: margin < 0 within 60 days
  const needing = balance.filter((b) => b.margin < 0 || b.status === "RED");
  const q = (o: { status?: string; dept?: string }) => {
    const p = new URLSearchParams();
    if (o.status) p.set("status", o.status);
    if (o.dept) p.set("dept", o.dept);
    return `?${p}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{ro.team.candidates}</h1>
          <p className="muted">Posibili angajați: studenți și absolvenți de la facultăți de specialitate, prezentări și concursuri (de ex. hackathoane).</p>
        </div>
        <Link href="/admin/candidates/new" className="btn-primary">
          Adaugă candidat
        </Link>
      </div>

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
        <Link href={q({ dept: sp.dept })} className={clsx("rounded-full border px-3 py-1", !sp.status ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
          Toți ({data.candidates.length})
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={q({ status: s, dept: sp.dept })} className={clsx("rounded-full border px-3 py-1", sp.status === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
            {ro.team.candidateStatuses[s]} ({counts[s]})
          </Link>
        ))}
        {sp.dept && (
          <Link href={q({ status: sp.status })} className="rounded-full border border-slate-300 bg-white px-3 py-1">
            interes: {sp.dept} ✕
          </Link>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nume</th>
              <th className="px-4 py-2">Facultate</th>
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
                  {c.event}
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
    </div>
  );
}
