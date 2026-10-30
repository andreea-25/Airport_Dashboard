import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getMyRequests } from "@/lib/services/employee";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";
import { STATUS_STYLES } from "@/lib/ui";
import NewRequestForm from "@/components/NewRequestForm";
import RequestPayload from "@/components/RequestPayload";

export default async function MyRequestsPage() {
  const s = await requireSession();
  if (!s.employeeId) redirect("/admin/requests");
  const requests = await getMyRequests(s);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="space-y-3">
        <h1 className="h1">{ro.requests.title}</h1>
        {requests.length === 0 && <p className="muted">{ro.requests.none}</p>}
        {requests.map((r) => (
          <div key={r.id} className="card card-pad space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">
                {ro.requests.types[r.type]}
                {r.createdByAI && <span className="badge ml-2 bg-violet-100 text-violet-800">{ro.requests.createdByAI}</span>}
              </div>
              <span className={`badge ${STATUS_STYLES[r.status]}`}>{ro.requests.statuses[r.status]}</span>
            </div>
            <div className="text-xs text-slate-500">{ro.requests.created}: {fmt(r.createdAt, "dd.MM.yyyy HH:mm")}</div>
            <RequestPayload payload={r.payload} />
            {r.adminResponse && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{ro.requests.response}:</span> {r.adminResponse}
              </div>
            )}
          </div>
        ))}
      </section>
      <aside className="card card-pad h-fit">
        <h2 className="h2 mb-3">{ro.requests.new}</h2>
        <NewRequestForm />
      </aside>
    </div>
  );
}
