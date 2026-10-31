"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { simulateRehire } from "@/app/actions/team";
import { READINESS_STYLES } from "@/lib/ui";

type Color = "GREEN" | "ORANGE" | "RED";
type Dept = {
  id: string;
  name: string;
  previous: boolean;
  teams: { id: string; name: string; green: number; hasLead: boolean }[];
  suggestedTeamId: string | null;
  readyBy: string;
  trainingDays: number;
  before: { margin: number; status: Color };
  after: { margin: number; status: Color };
};
const roD = (d: string) => d.split("-").reverse().join(".");
const m = (x: number) => (x >= 0 ? `+${x}` : String(x));

export default function RehireForm({ employeeId, depts, suggested }: { employeeId: string; depts: Dept[]; suggested: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const first = depts.find((d) => d.id === suggested) ?? depts[0];
  const [deptId, setDeptId] = useState(first?.id ?? "");
  const dept = depts.find((d) => d.id === deptId) ?? first;
  const [teamId, setTeamId] = useState(first?.suggestedTeamId ?? "");
  const [startDate, setStartDate] = useState(first?.readyBy ?? "");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Departament</label>
          <select
            className="input"
            value={deptId}
            onChange={(e) => {
              const d = depts.find((x) => x.id === e.target.value)!;
              setDeptId(d.id);
              setTeamId(d.suggestedTeamId ?? "");
              setStartDate(d.readyBy);
            }}
          >
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === suggested ? " (recomandat)" : d.previous ? " (fostul departament)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Echipă</label>
          <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {dept?.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.green} pe verde{t.hasLead ? "" : ", fără șef de tură"}
                {t.id === dept.suggestedTeamId ? " (recomandată)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Începe din</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="self-end pb-2 text-xs text-slate-500">
          {dept && (dept.trainingDays ? `Pregătire/reînnoiri: ${dept.trainingDays} zile lucrătoare (gata pe ${roD(dept.readyBy)})` : "Nu are nevoie de pregătire")}
        </div>
      </div>
      {dept && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <span>Semafor {dept.name}:</span>
          <span className={clsx("rounded-full border px-2 py-0.5 text-xs", READINESS_STYLES[dept.before.status].chip)}>
            {READINESS_STYLES[dept.before.status].label} {m(dept.before.margin)}
          </span>
          →
          <span className={clsx("rounded-full border px-2 py-0.5 text-xs", READINESS_STYLES[dept.after.status].chip)}>
            {READINESS_STYLES[dept.after.status].label} {m(dept.after.margin)}
          </span>
        </div>
      )}
      <button
        className="btn-primary"
        disabled={pending || !teamId}
        onClick={() =>
          start(async () => {
            const r = await simulateRehire({ employeeId, departmentId: deptId, teamId, startDate });
            if (r.error) setErr(r.error);
            else router.push(`/admin/simulation/${r.id}`);
          })
        }
      >
        {pending ? "Se creează scenariul…" : "Creează scenariul de simulare"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
