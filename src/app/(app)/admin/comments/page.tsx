import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";

export default async function AdminComments() {
  await requireAdminPage();
  const comments = await prisma.shiftComment.findMany({
    where: { parentId: null },
    include: { author: { include: { employee: true } }, shift: { include: { department: true } }, replies: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="h1">{ro.comments.allTitle}</h1>
      {comments.length === 0 && <p className="muted">{ro.comments.none}</p>}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="card card-pad">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{c.author.employee ? `${c.author.employee.firstName} ${c.author.employee.lastName}` : "Administrator"}</span>
              <span className="text-xs text-slate-500">{fmt(c.createdAt, "dd.MM.yyyy HH:mm")}</span>
            </div>
            <p className="mt-1 text-sm">{c.body}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                {ro.comments.onShift} {c.shift.department.name} · {fmt(c.shift.startAt, "dd.MM HH:mm")}–{fmt(c.shift.endAt, "HH:mm")}
              </span>
              <Link href={`/shifts/${c.shiftId}`} className="btn-secondary btn-sm">
                {c.replies.length ? `${c.replies.length} răspuns(uri)` : ro.comments.reply} ›
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
