"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Emp = { id: string; name: string; dept: string; level: string };
const TYPES = [
  { v: "RESIGNATION", l: "Demisionează" },
  { v: "CONTRACT_END", l: "I se termină contractul" },
  { v: "LEAVE", l: "Concediu lung" },
  { v: "MATERNITY", l: "Concediu maternitate" },
  { v: "SECONDMENT", l: "Detașare" },
];

/** "What if X resigns on …?" — opens the proposals page with a hypothetical event (nothing is saved). */
export default function WhatIfForm({ employees, horizon }: { employees: Emp[]; horizon: number }) {
  const router = useRouter();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ q: "", id: "", type: "RESIGNATION", from: in30, to: in90 });
  const permanent = f.type === "RESIGNATION" || f.type === "CONTRACT_END";
  const list = useMemo(() => {
    const q = f.q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return employees.filter((e) => !q || `${e.name} ${e.dept}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q)).slice(0, 200);
  }, [f.q, employees]);
  const go = () => {
    const id = f.id || list[0]?.id;
    if (!id) return;
    router.push(`/admin/team/${id}?h=${horizon}&what=${f.type}&from=${f.from}${permanent ? "" : `&to=${f.to}`}`);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto_auto_auto] sm:items-end">
      <div>
        <label className="label">Caută</label>
        <input className="input" placeholder="nume sau departament" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, id: "" })} />
      </div>
      <div>
        <label className="label">Angajat</label>
        <select className="input" value={f.id || list[0]?.id || ""} onChange={(e) => setF({ ...f, id: e.target.value })}>
          {list.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {e.level}, {e.dept}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Ce se întâmplă</label>
        <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {TYPES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{permanent ? "Ultima zi + 1" : "De la"}</label>
        <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
      </div>
      {!permanent ? (
        <div>
          <label className="label">Până la</label>
          <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
      ) : (
        <div />
      )}
      <button className="btn-primary" onClick={go}>
        Vezi soluții
      </button>
    </div>
  );
}
