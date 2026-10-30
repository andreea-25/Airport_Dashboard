"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeEmployeeSkill, upsertEmployeeSkill } from "@/app/actions/admin";
import { ro } from "@/lib/i18n/ro";

type Row = { skillId: string; name: string; type: string; proficiency: number; obtainedAt: string; expiresAt: string | null };

export default function SkillEditor({ employeeId, rows, skills }: { employeeId: string; rows: Row[]; skills: { id: string; name: string; hasExpiry: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState({ skillId: skills[0]?.id ?? "", proficiency: "1", obtainedAt: new Date().toISOString().slice(0, 10), expiresAt: "" });
  const today = new Date().toISOString().slice(0, 10);
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setErr(r.error ?? null); router.refresh(); });

  return (
    <div className="space-y-3">
      <table className="table">
        <thead>
          <tr><th>{ro.profile.skill}</th><th>{ro.profile.proficiency}</th><th>{ro.profile.expires}</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skillId}>
              <td>{r.name}<div className="text-xs text-slate-400">{ro.profile[r.type as "SKILL" | "CERTIFICATION"]}</div></td>
              <td>
                <select className="input py-1" defaultValue={r.proficiency} onChange={(e) => run(() => upsertEmployeeSkill({ employeeId, skillId: r.skillId, proficiency: Number(e.target.value), obtainedAt: r.obtainedAt, expiresAt: r.expiresAt }))}>
                  {[1, 2, 3].map((p) => <option key={p}>{p}</option>)}
                </select>
              </td>
              <td>
                {r.type === "CERTIFICATION" ? (
                  <input type="date" className={`input py-1 ${r.expiresAt && r.expiresAt < today ? "border-red-400 text-red-700" : ""}`} defaultValue={r.expiresAt ?? ""}
                    onBlur={(e) => e.target.value !== (r.expiresAt ?? "") && run(() => upsertEmployeeSkill({ employeeId, skillId: r.skillId, proficiency: r.proficiency, obtainedAt: r.obtainedAt, expiresAt: e.target.value || null }))} />
                ) : ro.common.none}
              </td>
              <td><button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => run(() => removeEmployeeSkill(employeeId, r.skillId))}>{ro.common.delete}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-5">
        <select className="input col-span-2" value={n.skillId} onChange={(e) => setN({ ...n, skillId: e.target.value })}>
          {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" value={n.proficiency} onChange={(e) => setN({ ...n, proficiency: e.target.value })}>
          {[1, 2, 3].map((p) => <option key={p}>{p}</option>)}
        </select>
        <input type="date" className="input" title={ro.profile.expires} value={n.expiresAt} onChange={(e) => setN({ ...n, expiresAt: e.target.value })} />
        <button className="btn-primary" disabled={pending} onClick={() => run(() => upsertEmployeeSkill({ employeeId, ...n }))}>{ro.admin.addSkill}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
