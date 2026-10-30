import Link from "next/link";
import clsx from "clsx";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";
import { STATUS_STYLES } from "@/lib/ui";
import RequestActions from "@/components/admin/RequestActions";
import RequestPayload from "@/components/RequestPayload";
import type { RequestStatus, RequestType } from "@/generated/prisma/enums";

type SP = Promise<{ status?: string; type?: string; ai?: string }>;

export default async function InboxPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage();
  const sp = await searchParams;
  const status = sp.status && sp.status in ro.requests.statuses ? (sp.status as RequestStatus) : undefined;
  const type = sp.type && sp.type in ro.requests.types ? (sp.type as RequestType) : undefined;
  const list = await prisma.request.findMany({
    where: { ...(status ? { status } : { status: { in: ["SUBMITTED", "IN_REVIEW"] } }), ...(type ? { type } : {}), ...(sp.ai ? { createdByAI: true } : {}) },
    include: { employee: { include: { department: true, team: true } } },
    orderBy: { createdAt: "desc" },
  });
  const link = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ status: sp.status, type: sp.type, ai: sp.ai, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="space-y-5">
      <h1 className="h1">{ro.requests.inboxTitle}</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={link({ status: undefined })} className={clsx("badge px-3 py-1", !status ? "bg-slate-900 text-white" : "bg-white border")}>{ro.requests.statuses.SUBMITTED} + {ro.requests.statuses.IN_REVIEW}</Link>
        {Object.entries(ro.requests.statuses).map(([k, v]) => (
          <Link key={k} href={link({ status: k })} className={clsx("badge px-3 py-1", status === k ? "bg-slate-900 text-white" : "border bg-white")}>{v}</Link>
        ))}
        <span className="mx-2 text-slate-300">|</span>
        <Link href={link({ type: undefined })} className={clsx("badge px-3 py-1", !type ? "bg-slate-900 text-white" : "border bg-white")}>{ro.common.all}</Link>
        {Object.entries(ro.requests.types).map(([k, v]) => (
          <Link key={k} href={link({ type: k })} className={clsx("badge px-3 py-1", type === k ? "bg-slate-900 text-white" : "border bg-white")}>{v}</Link>
        ))}
        <Link href={link({ ai: sp.ai ? undefined : "1" })} className={clsx("badge px-3 py-1", sp.ai ? "bg-violet-600 text-white" : "border bg-white")}>AI</Link>
      </div>
      {list.length === 0 && <p className="muted">{ro.requests.none}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((r) => (
          <div key={r.id} className="card card-pad space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {ro.requests.types[r.type]}
                  {r.createdByAI && <span className="badge ml-2 bg-violet-100 text-violet-800">{ro.requests.createdByAI}</span>}
                </div>
                <div className="text-sm text-slate-600">
                  <Link href={`/admin/employees/${r.employeeId}`} className="hover:underline">{r.employee.firstName} {r.employee.lastName}</Link> · {r.employee.department.name} · {r.employee.team?.name}
                </div>
                <div className="text-xs text-slate-400">{fmt(r.createdAt, "dd.MM.yyyy HH:mm")}</div>
              </div>
              <span className={`badge ${STATUS_STYLES[r.status]}`}>{ro.requests.statuses[r.status]}</span>
            </div>
            <RequestPayload payload={r.payload} />
            <RequestActions id={r.id} status={r.status} response={r.adminResponse} />
          </div>
        ))}
      </div>
    </div>
  );
}
