"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEmployee, setEmployeeActive } from "@/app/actions/admin";
import { ro } from "@/lib/i18n/ro";

type Opt = { id: string; name: string };
type Props = {
  employee?: { id: string; firstName: string; lastName: string; email: string; phone: string | null; departmentId: string; teamId: string | null; levelId: string; hireDate: string; contractEndDate?: string | null; active: boolean };
  departments: Opt[];
  teams: (Opt & { departmentId: string })[];
  levels: Opt[];
};

export default function EmployeeForm({ employee, departments, teams, levels }: Props) {
  const router = useRouter();
  const [f, setF] = useState({
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    departmentId: employee?.departmentId ?? departments[0]?.id ?? "",
    teamId: employee?.teamId ?? "",
    levelId: employee?.levelId ?? levels[0]?.id ?? "",
    hireDate: employee?.hireDate ?? new Date().toISOString().slice(0, 10),
    contractEndDate: employee?.contractEndDate ?? "",
    createAccount: true,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leave, setLeave] = useState({ leftAt: new Date().toISOString().slice(0, 10), reason: "RESIGNATION", rehireEligible: true, note: "" });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value, ...(k === "departmentId" ? { teamId: "" } : {}) }));
  const deptTeams = teams.filter((t) => t.departmentId === f.departmentId);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={ro.admin.firstName}><input className="input" value={f.firstName} onChange={set("firstName")} /></Field>
        <Field label={ro.admin.lastName}><input className="input" value={f.lastName} onChange={set("lastName")} /></Field>
        <Field label={ro.admin.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={ro.admin.phone}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={ro.profile.department}>
          <select className="input" value={f.departmentId} onChange={set("departmentId")}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={ro.profile.team}>
          <select className="input" value={f.teamId} onChange={set("teamId")}>
            <option value="">{ro.common.none}</option>
            {deptTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label={ro.profile.level}>
          <select className="input" value={f.levelId} onChange={set("levelId")}>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label={ro.admin.hireDate}><input className="input" type="date" value={f.hireDate} onChange={set("hireDate")} /></Field>
        <Field label={ro.team.contractEnd}><input className="input" type="date" value={f.contractEndDate} onChange={set("contractEndDate")} /></Field>
      </div>
      {!employee && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.createAccount} onChange={set("createAccount")} /> {ro.admin.createAccount}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveEmployee(employee?.id ?? null, f);
              if (r.error) setMsg(r.error);
              else if (!employee && r.id) router.push(`/admin/employees/${r.id}`);
              else { setMsg("✓"); router.refresh(); }
            })
          }
        >
          {ro.common.save}
        </button>
        {employee && (
          <button
            className={employee.active ? "btn-danger" : "btn-secondary"}
            disabled={pending}
            onClick={() =>
              employee.active ? setLeaving(true) : start(async () => { await setEmployeeActive(employee.id, true); router.refresh(); })
            }
          >
            {employee.active ? ro.admin.deactivate : ro.admin.activate}
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
      {employee && leaving && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-medium text-red-900">Plecare din firmă (rămâne în istoric, la Candidați → Foști angajați)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Ultima zi</label>
              <input type="date" className="input" value={leave.leftAt} onChange={(e) => setLeave({ ...leave, leftAt: e.target.value })} />
            </div>
            <div>
              <label className="label">Motiv</label>
              <select className="input" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })}>
                <option value="RESIGNATION">Demisie</option>
                <option value="CONTRACT_END">Final de contract</option>
                <option value="RETIREMENT">Pensionare</option>
                <option value="OTHER">Alt motiv</option>
              </select>
            </div>
          </div>
          <input className="input" placeholder="Notă (opțional), ex. s-ar întoarce peste un an" value={leave.note} onChange={(e) => setLeave({ ...leave, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={leave.rehireEligible} onChange={(e) => setLeave({ ...leave, rehireEligible: e.target.checked })} /> Eligibil pentru reangajare
          </label>
          <div className="flex gap-2">
            <button
              className="btn-danger btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setEmployeeActive(employee.id, false, leave);
                  if (r.error) setMsg(r.error);
                  else {
                    setLeaving(false);
                    router.refresh();
                  }
                })
              }
            >
              {ro.admin.deactivate}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setLeaving(false)}>
              {ro.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
