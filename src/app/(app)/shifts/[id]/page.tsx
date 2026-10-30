import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { AccessError, getShiftDetail } from "@/lib/services/employee";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";
import Comments from "@/components/Comments";

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let shift;
  try {
    shift = await getShiftDetail(s, id);
  } catch (e) {
    if (e instanceof AccessError) return <p className="card card-pad text-red-700">{ro.common.forbidden}</p>;
    notFound();
  }
  const lead = shift.colleagues.find((c) => c.isLead);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href={s.role === "ADMIN" && !s.employeeId ? "/admin/shifts" : "/shifts"} className="text-sm text-brand-600 hover:underline">‹ {ro.common.back}</Link>
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">{ro.shifts.detail}</div>
            <h1 className="h1 capitalize">{fmt(shift.startAt, "EEEE, dd.MM.yyyy")}</h1>
            <div className="flight-board mt-1 text-3xl font-semibold text-slate-900">
              {fmt(shift.startAt, "HH:mm")} – {fmt(shift.endAt, "HH:mm")}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-500">{ro.shifts.department}</dt>
            <dd className="font-medium">{shift.department}</dd>
            <dt className="text-slate-500">{ro.shifts.team}</dt>
            <dd className="font-medium">{shift.team ?? ro.common.none}</dd>
            <dt className="text-slate-500">{ro.shifts.lead}</dt>
            <dd className="font-medium">{lead?.name ?? <span className="text-red-600">{ro.shifts.noLead}</span>}</dd>
          </dl>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="card card-pad">
          <h2 className="h2 mb-3">{ro.shifts.colleagues} ({shift.colleagues.length})</h2>
          <ul className="divide-y divide-slate-100">
            {shift.colleagues.map((c) => (
              <li key={c.employeeId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">
                    {c.name} {c.isMe && <span className="text-xs text-brand-600">({ro.shifts.you})</span>}
                  </div>
                  <div className="text-xs text-slate-500">{c.position ?? ro.common.none}</div>
                </div>
                <div className="text-right">
                  <span className="badge bg-slate-100 text-slate-700">{c.level}</span>
                  {c.isLead && <span className="badge ml-1 bg-amber-100 text-amber-900">{ro.shifts.lead}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card card-pad">
          <h2 className="h2 mb-3">{ro.comments.title}</h2>
          <Comments
            shiftId={shift.id}
            userId={s.userId}
            isAdmin={s.role === "ADMIN"}
            comments={shift.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
          />
        </section>
      </div>
    </div>
  );
}
