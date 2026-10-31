"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { setCandidateStatus } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

const FLOW = ["NEW", "CONTACTED", "INTERVIEW", "OFFER"] as const;

export default function CandidateStatus({ id, status, hiredEmployee }: { id: string; status: string; hiredEmployee: { id: string; name: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (status === "HIRED")
    return (
      <div className="card card-pad text-sm">
        ✓ Angajat{" "}
        {hiredEmployee && (
          <Link className="text-brand-600 hover:underline" href={`/admin/employees/${hiredEmployee.id}`}>
            — vezi fișa angajatului {hiredEmployee.name}
          </Link>
        )}
      </div>
    );
  const set = (s: (typeof FLOW)[number] | "REJECTED") =>
    start(async () => {
      await setCandidateStatus(id, s);
      router.refresh();
    });
  const idx = FLOW.indexOf(status as (typeof FLOW)[number]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FLOW.map((s, i) => (
        <button
          key={s}
          disabled={pending}
          onClick={() => set(s)}
          className={clsx(
            "rounded-full border px-3 py-1 text-sm",
            status === s ? "border-slate-900 bg-slate-900 text-white" : i < idx ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600",
          )}
        >
          {i + 1}. {ro.team.candidateStatuses[s]}
        </button>
      ))}
      <button
        disabled={pending}
        onClick={() => set("REJECTED")}
        className={clsx("ml-2 rounded-full border px-3 py-1 text-sm", status === "REJECTED" ? "border-red-600 bg-red-600 text-white" : "border-red-200 bg-white text-red-700")}
      >
        {ro.team.candidateStatuses.REJECTED}
      </button>
    </div>
  );
}
