"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { deleteProject, saveProject } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

const TYPES: [string, string][] = [
  ["COURSE", "Curs"],
  ["PRESENTATION", "Prezentare"],
  ["COMPETITION", "Competiție / concurs"],
  ["HACKATHON", "Hackathon"],
  ["INTERNSHIP", "Stagiu de practică"],
  ["OPEN_DAY", "Zi porți deschise"],
  ["WEBINAR", "Webinar"],
];
const STATUSES: [string, string][] = [
  ["PROPOSED", "Propus"],
  ["PLANNED", "Planificat"],
  ["ONGOING", "În desfășurare"],
  ["DONE", "Încheiat"],
  ["CANCELLED", "Anulat"],
];
type P = {
  id: string;
  title: string;
  type: string;
  institution: string;
  targetDepartments: string[];
  startDate: string;
  endDate: string;
  status: string;
  description: string;
  expectedReach: string;
};

export default function ProjectForm({ project, departments }: { project?: P; departments: { id: string; name: string; code: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Omit<P, "id">>(
    project ?? { title: "", type: "PRESENTATION", institution: "", targetDepartments: [], startDate: "", endDate: "", status: "PROPOSED", description: "", expectedReach: "" },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const toggle = (code: string) =>
    setF((p) => ({ ...p, targetDepartments: p.targetDepartments.includes(code) ? p.targetDepartments.filter((x) => x !== code) : [...p.targetDepartments, code] }));

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Titlu</label>
        <input className="input" value={f.title} onChange={set("title")} placeholder="ex. Prezentare: meserii în aeroport" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Tip</label>
          <select className="input" value={f.type} onChange={set("type")}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={set("status")}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Facultate / școală / partener</label>
          <input className="input" value={f.institution} onChange={set("institution")} placeholder="ex. Universitatea din Craiova – Facultatea de Mecanică" />
        </div>
        <div>
          <label className="label">De la</label>
          <input type="date" className="input" value={f.startDate} onChange={set("startDate")} />
        </div>
        <div>
          <label className="label">Până la</label>
          <input type="date" className="input" value={f.endDate} onChange={set("endDate")} />
        </div>
        <div>
          <label className="label">Participanți estimați</label>
          <input type="number" min={0} className="input" value={f.expectedReach} onChange={set("expectedReach")} />
        </div>
      </div>
      <div>
        <label className="label">Pentru ce departamente recrutăm</label>
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.code)}
              className={clsx("rounded-full border px-2.5 py-1 text-xs", f.targetDepartments.includes(d.code) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Descriere</label>
        <textarea className="input min-h-24" value={f.description} onChange={set("description")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveProject(project?.id ?? null, { ...f, type: f.type as "COURSE", status: f.status as "PROPOSED" });
              if (r.error) setMsg(r.error);
              else if (!project && r.id) router.push(`/admin/candidates/projects/${r.id}`);
              else {
                setMsg("✓ Salvat");
                router.refresh();
              }
            })
          }
        >
          {ro.common.save}
        </button>
        {project && (
          <button
            className="btn-ghost text-red-600"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!window.confirm("Ștergi proiectul? Candidații rămân, doar fără legătura cu proiectul.")) return;
                const r = await deleteProject(project.id);
                if (r.error) setMsg(r.error);
                else router.push("/admin/candidates?view=projects");
              })
            }
          >
            {ro.common.delete}
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
