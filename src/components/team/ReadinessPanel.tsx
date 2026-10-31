"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { addAvailabilityEvent, clearReadinessOverride, deleteAvailabilityEvent, setReadinessOverride } from "@/app/actions/team";
import { ro } from "@/lib/i18n/ro";
import { READINESS_STYLES } from "@/lib/ui";

type Color = "GREEN" | "ORANGE" | "RED";
type Props = {
  employeeId: string;
  horizon: number;
  color: Color;
  auto: Color;
  reasons: { color: Color; text: string }[];
  override: { color: Color; reason: string; validUntil: string | null } | null;
  events: { id: string; type: string; start: string; end: string | null; note: string | null; source: "EVENT" | "REQUEST" | "CONTRACT" }[];
  labels: Record<string, string>;
  showSolutionsLink?: boolean;
};

const PERMANENT = ["RESIGNATION", "CONTRACT_END"];
const ro_ = (d: string) => d.split("-").reverse().join(".");

export default function ReadinessPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [ov, setOv] = useState({ color: p.color === "GREEN" ? "ORANGE" : "GREEN", reason: "", validUntil: "" });
  const [ev, setEv] = useState({ type: "LEAVE", startDate: today, endDate: "", note: "" });
  const [showOv, setShowOv] = useState(false);
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setErr(r.error ?? null);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  const st = READINESS_STYLES[p.color];
  const permanent = PERMANENT.includes(ev.type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={clsx("h-5 w-5 rounded-full", st.dot)} />
        <span className={clsx("rounded-full border px-3 py-0.5 text-sm font-medium", st.chip)}>{st.label}</span>
        <span className="text-xs text-slate-500">
          {p.override ? `${ro.team.manual} (automat: ${READINESS_STYLES[p.auto].label.toLowerCase()})` : `${ro.team.auto}, următoarele ${p.horizon} de zile`}
        </span>
        {p.showSolutionsLink && p.color !== "GREEN" && (
          <Link href={`/admin/team/${p.employeeId}?h=${p.horizon}`} className="btn-secondary btn-sm ml-auto">
            {ro.team.proposals}
          </Link>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {p.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", READINESS_STYLES[r.color].dot)} />
            {r.text}
          </li>
        ))}
        {p.reasons.length === 0 && <li className="text-slate-500">Nimic de semnalat.</li>}
      </ul>

      {/* manual override */}
      <div className="rounded-lg bg-slate-50 p-3">
        {!showOv ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setShowOv(true)}>
              {ro.team.override}
            </button>
            {p.override && (
              <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => clearReadinessOverride(p.employeeId))}>
                {ro.team.clearOverride}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              {(["GREEN", "ORANGE", "RED"] as Color[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setOv({ ...ov, color: c })}
                  className={clsx("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm", ov.color === c ? READINESS_STYLES[c].chip + " font-medium" : "border-slate-200 bg-white")}
                >
                  <span className={clsx("h-2.5 w-2.5 rounded-full", READINESS_STYLES[c].dot)} />
                  {READINESS_STYLES[c].label}
                </button>
              ))}
            </div>
            <input className="input" placeholder={ro.team.overrideReason} value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500">{ro.team.overrideUntil}</label>
              <input type="date" className="input w-auto py-1" value={ov.validUntil} onChange={(e) => setOv({ ...ov, validUntil: e.target.value })} />
              <button
                className="btn-primary btn-sm"
                disabled={pending}
                onClick={() => run(() => setReadinessOverride({ employeeId: p.employeeId, color: ov.color as Color, reason: ov.reason, validUntil: ov.validUntil }), () => setShowOv(false))}
              >
                {ro.common.save}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setShowOv(false)}>
                {ro.common.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* availability */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">{ro.team.availability}</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {p.events.length === 0 && <li className="py-1 text-slate-500">{ro.team.noEvents}</li>}
          {p.events.map((e) => (
            <li key={e.id} className={clsx("flex items-center gap-2 py-1.5", e.end && e.end < today && "opacity-50")}>
              <div className="flex-1">
                <span className="font-medium">{p.labels[e.type] ?? e.type}</span>{" "}
                <span className="text-slate-600">
                  {e.end ? `${ro_(e.start)} – ${ro_(e.end)}` : `din ${ro_(e.start)} ${ro.team.toPermanent}`}
                </span>
                {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
              </div>
              {e.source === "EVENT" ? (
                <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => run(() => deleteAvailabilityEvent(e.id))}>
                  {ro.common.delete}
                </button>
              ) : (
                <span className="text-xs text-slate-400">{e.source === "REQUEST" ? "din cereri" : "din fișă"}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <select className="input" value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })}>
            {Object.entries(p.labels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input className="input" placeholder={ro.team.note} value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} />
          <label className="text-xs text-slate-500">
            {permanent ? "Prima zi în care nu mai lucrează" : ro.team.from}
            <input type="date" className="input mt-1" value={ev.startDate} onChange={(e) => setEv({ ...ev, startDate: e.target.value })} />
          </label>
          {!permanent ? (
            <label className="text-xs text-slate-500">
              {ro.team.to}
              <input type="date" className="input mt-1" value={ev.endDate} onChange={(e) => setEv({ ...ev, endDate: e.target.value })} />
            </label>
          ) : (
            <div className="self-end pb-2 text-xs text-slate-500">Plecare definitivă — nu are dată de întoarcere.</div>
          )}
          <button
            className="btn-primary sm:col-span-2"
            disabled={pending}
            onClick={() => run(() => addAvailabilityEvent({ employeeId: p.employeeId, ...ev, type: ev.type as "LEAVE" }), () => setEv({ ...ev, note: "", endDate: "" }))}
          >
            {ro.team.addAvailability}
          </button>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
