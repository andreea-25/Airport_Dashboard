import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ro } from "@/lib/i18n/ro";
import Nav, { type NavItem } from "@/components/Nav";
import { logoutAction } from "@/app/actions/auth";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [unread, newRequests, employee] = await Promise.all([
    prisma.notification.count({ where: { userId: s.userId, read: false } }),
    s.role === "ADMIN" ? prisma.request.count({ where: { status: "SUBMITTED" } }) : Promise.resolve(0),
    s.employeeId ? prisma.employee.findUnique({ where: { id: s.employeeId }, include: { department: true } }) : Promise.resolve(null),
  ]);
  const sections: { title: string; items: NavItem[] }[] = [];
  if (s.employeeId) {
    sections.push({
      title: ro.nav.employeeSection,
      items: [
        { href: "/shifts", label: ro.nav.myShifts },
        { href: "/profile", label: ro.nav.profile },
        { href: "/assistant", label: ro.nav.assistant },
        { href: "/requests", label: ro.nav.myRequests },
      ],
    });
  }
  if (s.role === "ADMIN") {
    sections.push({
      title: ro.nav.adminSection,
      items: [
        { href: "/admin/today", label: ro.nav.today },
        { href: "/admin/simulation", label: ro.nav.simulation },
        { href: "/admin/requests", label: ro.nav.requestsInbox, badge: newRequests },
        { href: "/admin/shifts", label: ro.nav.shifts },
        { href: "/admin/employees", label: ro.nav.employees },
        { href: "/admin/teams", label: ro.nav.teams },
        { href: "/admin/comments", label: ro.nav.comments },
        { href: "/admin/audit", label: ro.nav.audit },
      ],
    });
  }
  sections.push({ title: "", items: [{ href: "/notifications", label: ro.nav.notifications, badge: unread }] });

  const displayName = employee ? `${employee.firstName} ${employee.lastName}` : s.email;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="flex flex-col bg-[#0b1f3a] px-3 py-5 text-white lg:sticky lg:top-0 lg:h-screen">
        <Link href="/" className="mb-8 block px-3">
          <div className="flight-board text-[11px] uppercase tracking-[0.3em] text-amber-300">CRA</div>
          <div className="text-lg font-semibold">{ro.app.name}</div>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <Nav sections={sections} />
        </div>
        <div className="mt-6 border-t border-white/10 px-3 pt-4">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="text-xs text-slate-400">
            {ro.roles[s.role]}
            {employee ? ` · ${employee.department.name}` : ""}
          </div>
          <form action={logoutAction} className="mt-3">
            <button className="text-xs text-slate-300 underline-offset-2 hover:underline">{ro.auth.logout}</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
