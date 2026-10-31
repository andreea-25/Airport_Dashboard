"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySolutionToScenario } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

export default function ApplySolutionButton(props: {
  employeeId: string;
  horizon: number;
  extensionDays: number;
  optionIndex: number;
  whatIf?: { type: string; start: string; end?: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn-secondary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await applySolutionToScenario(props);
            if (r.error) setErr(r.error);
            else router.push(`/admin/simulation/${r.id}`);
          })
        }
      >
        {pending ? ro.common.loading : ro.team.applyInScenario}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
