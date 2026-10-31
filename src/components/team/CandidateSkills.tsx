"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCandidateSkill, upsertCandidateSkill } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

type Row = { skillId: string; name: string; type: string; proficiency: number; expiresAt: string | null };

export default function CandidateSkills({ candidateId, rows, skills }: { candidateId: string; rows: Row[]; skills: { id: string; name: string; hasExpiry: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState({ skillId: skills[0]?.id ?? "", proficiency: "1", expiresAt: "" });
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setErr(r.error ?? null);
      router.refresh();
    });
  const hasExpiry = skills.find((s) => s.id === n.skillId)?.hasExpiry;

  return (
    <div className="space-y-3">
      <table className="table">
        <thead>
          <tr>
            <th>{ro.profile.skill}</th>
            <th>{ro.profile.proficiency}</th>
            <th>{ro.profile.expires}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="text-slate-500">
                Nicio competență încă.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.skillId}>
              <td>{r.name}</td>
              <td>
                <select className="input py-1" defaultValue={r.proficiency} onChange={(e) => run(() => upsertCandidateSkill({ candidateId, skillId: r.skillId, proficiency: Number(e.target.value), expiresAt: r.expiresAt }))}>
                  {[1, 2, 3].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </td>
              <td>{r.expiresAt ?? ro.common.none}</td>
              <td>
                <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => run(() => removeCandidateSkill(candidateId, r.skillId))}>
                  {ro.common.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-5">
        <select className="input col-span-2" value={n.skillId} onChange={(e) => setN({ ...n, skillId: e.target.value })}>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" value={n.proficiency} onChange={(e) => setN({ ...n, proficiency: e.target.value })}>
          {[1, 2, 3].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input type="date" className="input" disabled={!hasExpiry} title={ro.profile.expires} value={n.expiresAt} onChange={(e) => setN({ ...n, expiresAt: e.target.value })} />
        <button className="btn-primary" disabled={pending} onClick={() => run(() => upsertCandidateSkill({ candidateId, ...n, expiresAt: hasExpiry ? n.expiresAt : "" }))}>
          {ro.admin.addSkill}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
