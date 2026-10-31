"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { deleteCandidate, saveCandidate } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";

type C = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  university: string;
  specialization: string;
  studyYear: string;
  event: string;
  eventDate: string;
  interests: string[];
  availableFrom: string;
  notes: string;
  consent: boolean;
  projectId: string;
};
type Proj = { id: string; title: string; startDate: string; targetDepartments: string[] };

export default function CandidateForm({
  candidate,
  departments,
  projects,
  initialProjectId,
}: {
  candidate?: C;
  departments: { id: string; name: string; code: string }[];
  projects: Proj[];
  initialProjectId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Omit<C, "id">>(
    candidate ?? {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      university: "",
      specialization: "",
      studyYear: "",
      event: "",
      eventDate: "",
      interests: [],
      availableFrom: "",
      notes: "",
      consent: false,
      projectId: initialProjectId ?? "",
      ...(initialProjectId
        ? {
            event: projects.find((p) => p.id === initialProjectId)?.title ?? "",
            eventDate: projects.find((p) => p.id === initialProjectId)?.startDate ?? "",
            interests: projects.find((p) => p.id === initialProjectId)?.targetDepartments ?? [],
          }
        : {}),
    },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const toggle = (code: string) => setF((p) => ({ ...p, interests: p.interests.includes(code) ? p.interests.filter((x) => x !== code) : [...p.interests, code] }));
  const field = (k: keyof typeof f, label: string, type = "text", placeholder?: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} placeholder={placeholder} value={f[k] as string} onChange={set(k)} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("firstName", ro.admin.firstName)}
        {field("lastName", ro.admin.lastName)}
        {field("email", ro.admin.email, "email")}
        {field("phone", ro.admin.phone)}
        {field("university", "Universitate / școală", "text", "ex. Universitatea din Craiova – Facultatea de Mecanică")}
        {field("specialization", "Specializare", "text", "ex. Ingineria transporturilor")}
        {field("studyYear", "An de studiu", "text", "ex. Anul III / Master I / Absolvent")}
        {field("availableFrom", "Disponibil din", "date")}
        {field("event", "Unde l-am cunoscut", "text", "ex. Hackathon Aeroport 2026, prezentare la facultate")}
        {field("eventDate", "Data evenimentului", "date")}
      </div>
      <div>
        <label className="label">Proiect de recrutare (opțional)</label>
        <select
          className="input"
          value={f.projectId}
          onChange={(e) => {
            const pr = projects.find((p) => p.id === e.target.value);
            setF((p) => ({ ...p, projectId: e.target.value, ...(pr ? { event: pr.title, eventDate: pr.startDate || p.eventDate, interests: p.interests.length ? p.interests : pr.targetDepartments } : {}) }));
          }}
        >
          <option value="">— fără proiect (eveniment scris liber) —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Departamente de interes</label>
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.code)}
              className={clsx("rounded-full border px-2.5 py-1 text-xs", f.interests.includes(d.code) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Note</label>
        <textarea className="input min-h-20" value={f.notes} onChange={set("notes")} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.consent} onChange={(e) => setF((p) => ({ ...p, consent: e.target.checked }))} /> {ro.team.consent}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveCandidate(candidate?.id ?? null, f);
              if (r.error) setMsg(r.error);
              else if (!candidate && r.id) router.push(`/admin/candidates/${r.id}`);
              else {
                setMsg("✓ Salvat");
                router.refresh();
              }
            })
          }
        >
          {ro.common.save}
        </button>
        {candidate && (
          <button
            className="btn-ghost text-red-600"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!window.confirm("Ștergi candidatul din baza de talente? (de ex. și-a retras acordul)")) return;
                const r = await deleteCandidate(candidate.id);
                if (r.error) setMsg(r.error);
                else router.push("/admin/candidates");
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
