"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hireCandidate } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

type Opt = { id: string; name: string };
export default function HireForm(p: {
  candidateId: string;
  departments: Opt[];
  teams: (Opt & { departmentId: string })[];
  levels: Opt[];
  defaultDepartmentId?: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    departmentId: p.defaultDepartmentId ?? "",
    teamId: "",
    levelId: p.levels[0]?.id ?? "",
    hireDate: p.defaultDate,
    contractEndDate: "",
    createAccount: true,
  });
  const teams = p.teams.filter((t) => t.departmentId === f.departmentId);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{ro.profile.department}</label>
          <select className="input" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, teamId: "" })}>
            {p.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{ro.profile.team}</label>
          <select className="input" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
            <option value="">{ro.common.none}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{ro.profile.level}</label>
          <select className="input" value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}>
            {p.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{ro.admin.hireDate}</label>
          <input className="input" type="date" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">{ro.team.contractEnd}</label>
          <input className="input" type="date" value={f.contractEndDate} onChange={(e) => setF({ ...f, contractEndDate: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.createAccount} onChange={(e) => setF({ ...f, createAccount: e.target.checked })} /> {ro.admin.createAccount}
      </label>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await hireCandidate({ candidateId: p.candidateId, ...f });
            if (r.error) setErr(r.error);
            else router.push(`/admin/employees/${r.id}`);
          })
        }
      >
        {ro.team.hire}
      </button>
      <p className="text-xs text-slate-500">Competențele candidatului se copiază în fișa angajatului; candidatul rămâne în istoric cu statusul „Angajat”.</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
