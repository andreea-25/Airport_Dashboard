import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";
import { markNotificationsRead } from "@/app/actions/requests";

export default async function NotificationsPage() {
  const s = await requireSession();
  const list = await prisma.notification.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "desc" }, take: 100 });
  const href = (n: (typeof list)[number]) =>
    n.type === "NEW_REQUEST" ? "/admin/requests" : n.type === "REQUEST_STATUS" ? "/requests" : n.refId ? `/shifts/${n.refId}` : "#";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="h1">{ro.notifications.title}</h1>
        <form action={markNotificationsRead}><button className="btn-secondary">{ro.notifications.markRead}</button></form>
      </div>
      {list.length === 0 && <p className="muted">{ro.notifications.none}</p>}
      <ul className="card divide-y divide-slate-100">
        {list.map((n) => (
          <li key={n.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={href(n)} className={n.read ? "text-slate-500" : "font-medium text-slate-900"}>
              {!n.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-400" />}
              {n.message}
            </Link>
            <span className="text-xs text-slate-400">{fmt(n.createdAt, "dd.MM HH:mm")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
