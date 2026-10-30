"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDepartment, saveTeam } from "@/app/actions/admin";
import { ro } from "@/lib/i18n/ro";

export function AddTeam({ departmentId }: { departmentId: string }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <input className="input py-1" placeholder={ro.admin.teamName} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-secondary btn-sm" disabled={pending || !name.trim()} onClick={() => start(async () => { await saveTeam(null, departmentId, name); setName(""); router.refresh(); })}>
        + {ro.admin.addTeam}
      </button>
    </div>
  );
}

export function RenameTeam({ id, departmentId, name }: { id: string; departmentId: string; name: string }) {
  const [v, setV] = useState(name);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <input
      className="input py-1"
      value={v}
      disabled={pending}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== name && v.trim() && start(async () => { await saveTeam(id, departmentId, v); router.refresh(); })}
    />
  );
}

export function DepartmentForm({ id, name, code }: { id?: string; name?: string; code?: string }) {
  const [f, setF] = useState({ name: name ?? "", code: code ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <input className="input max-w-xs py-1" placeholder={ro.admin.departmentName} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input w-24 py-1" placeholder={ro.admin.departmentCode} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
      <button
        className="btn-secondary btn-sm"
        disabled={pending}
        onClick={() => start(async () => { const r = await saveDepartment(id ?? null, f.name, f.code); setErr(r.error ?? null); if (!r.error && !id) setF({ name: "", code: "" }); router.refresh(); })}
      >
        {id ? ro.common.save : `+ ${ro.admin.addDepartment}`}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
