"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export type NavItem = { href: string; label: string; badge?: number };

export default function Nav({ sections }: { sections: { title: string; items: NavItem[] }[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-6">
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{sec.title}</div>
          <ul className="space-y-0.5">
            {sec.items.map((it) => {
              const active = path === it.href || (it.href !== "/" && path.startsWith(it.href + "/"));
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={clsx(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition",
                      active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span>{it.label}</span>
                    {!!it.badge && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-slate-900">{it.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
