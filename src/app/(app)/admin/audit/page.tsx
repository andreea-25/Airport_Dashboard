import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; page?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.entity ? { entity: sp.entity } : {};
  const [rows, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { include: { employee: true } } }, orderBy: { createdAt: "desc" }, take: 50, skip: (page - 1) * 50 }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="h1">{ro.admin.auditTitle}</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="?" className={`badge px-3 py-1 ${!sp.entity ? "bg-slate-900 text-white" : "border bg-white"}`}>{ro.common.all}</Link>
        {entities.map((e) => (
          <Link key={e.entity} href={`?entity=${e.entity}`} className={`badge px-3 py-1 ${sp.entity === e.entity ? "bg-slate-900 text-white" : "border bg-white"}`}>{e.entity}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>{ro.admin.when}</th><th>{ro.admin.actor}</th><th>{ro.admin.entity}</th><th>{ro.admin.action}</th><th>{ro.admin.diff}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs">{fmt(r.createdAt, "dd.MM.yyyy HH:mm:ss")}</td>
                <td className="text-xs">{r.actor ? (r.actor.employee ? `${r.actor.employee.firstName} ${r.actor.employee.lastName}` : r.actor.email) : ro.admin.system}</td>
                <td className="text-xs">{r.entity}<div className="text-slate-400">{r.entityId.slice(0, 14)}</div></td>
                <td><span className="badge bg-slate-100 text-slate-700">{r.action}</span></td>
                <td><pre className="max-w-xl overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-600">{r.diff ? JSON.stringify(r.diff, null, 0).slice(0, 400) : ""}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary" href={`?${new URLSearchParams({ ...(sp.entity ? { entity: sp.entity } : {}), page: String(page - 1) })}`}>‹</Link>}
        {rows.length === 50 && <Link className="btn-secondary" href={`?${new URLSearchParams({ ...(sp.entity ? { entity: sp.entity } : {}), page: String(page + 1) })}`}>›</Link>}
      </div>
    </div>
  );
}
