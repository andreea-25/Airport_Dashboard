"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProject } from "@/app/actions/team";

type S = { title: string; type: string; institution: string; deptCode: string; reach: number; why: string };

/** Turns an automatic suggestion into a project with status "Propus" (editable afterwards). */
export default function SuggestProjectButton({ suggestion }: { suggestion: S }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        className="btn-secondary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveProject(null, {
              title: suggestion.title,
              type: suggestion.type as "COURSE",
              institution: suggestion.institution,
              targetDepartments: [suggestion.deptCode],
              status: "PROPOSED",
              description: `Propus automat: ${suggestion.why}.`,
              expectedReach: suggestion.reach,
            });
            if (r.error) setErr(r.error);
            else router.push(`/admin/candidates/projects/${r.id}`);
          })
        }
      >
        Adaugă ca propunere
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
