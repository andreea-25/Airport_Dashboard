"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";
import {
  applyScenarioToReal,
  applySimChanges,
  applySuggestion,
  dismissSuggestion,
  previewSimChange,
  skillGapAction,
  undoSimChange,
  type SimView,
} from "@/app/actions/simulation";
import type { Comparison } from "@/lib/sim/evaluate";
import type { SkillGap } from "@/lib/sim/scenario";
import type { CalendarData } from "@/lib/sim/calendar";
import type { ScenarioSettings } from "@/lib/sim/types";
import { ro } from "@/lib/i18n/ro";
import { STATUS_STYLES } from "@/lib/ui";
import { CoverageHeatmap, DeptCoverageChart, KpiRow } from "./Charts";
import ScenarioCalendar from "./ScenarioCalendar";
import OptimizerPanel from "./OptimizerPanel";
import WhatIfPanel from "./WhatIfPanel";
import FairnessPanel from "./FairnessPanel";

type Dept = { id: string; name: string; code: string };
type Team = { id: string; name: string; departmentId: string };
type Emp = { id: string; name: string; departmentId: string; teamId: string | null; level: string };
type Suggestion = { id: string; source: string; rationale: string; status: string; changes: unknown; estimatedImpact: unknown; createdAt: string };
type Props = {
  scenario: { id: string; name: string; period: string; notes: string | null };
  view: SimView;
  history: { id: string; type: string; message: string; createdAt: string }[];
  suggestions: Suggestion[];
  departments: Dept[];
  teams: Team[];
  employees: Emp[];
  levels: { id: string; name: string; rank: number }[];
  skills: { id: string; name: string; type: string }[];
  startTimes: Record<string, string[]>;
  calendar: CalendarData;
  settings: ScenarioSettings;
};

type Tab = "overview" | "calendar" | "optimize" | "whatif" | "fairness";

export default function SimWorkspace(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ messages: string[]; impact: Comparison } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [applyOpen, setApplyOpen] = useState(false);

  const showFlash = (ok: boolean, text: string) => {
    setFlash({ kind: ok ? "ok" : "err", text });
    start(() => router.refresh());
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; messages?: string[] }>) =>
    start(async () => {
      const r = await fn();
      setPreview(null);
      setFlash(r.ok ? { kind: "ok", text: r.message ?? r.messages?.join(" · ") ?? ro.sim.applied } : { kind: "err", text: r.error ?? ro.common.errorGeneric });
      router.refresh();
    });
  /** apply a batch of changes as one undoable step; resolves true on success */
  const applyBatch = async (changes: unknown[], label: string) => {
    const r = await applySimChanges(p.scenario.id, changes, label);
    setPreview(null);
    setFlash(r.ok ? { kind: "ok", text: r.message } : { kind: "err", text: r.error });
    start(() => router.refresh());
    return r.ok;
  };
  const apply = (change: unknown) => applyBatch([change], "");
  const doPreview = (change: unknown) =>
    start(async () => {
      const r = await previewSimChange(p.scenario.id, change);
      if (r.ok) setPreview({ messages: r.messages, impact: r.impact });
      else setFlash({ kind: "err", text: r.error });
    });

  const tabs: [Tab, string][] = Object.entries(ro.sim.tabs) as [Tab, string][];
  const pendingSugg = p.suggestions.filter((s) => s.status === "PENDING").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/simulation" className="text-sm text-brand-600 hover:underline">‹ {ro.sim.scenarios}</Link>
          <h1 className="h1">{p.scenario.name}</h1>
          <p className="muted">{p.scenario.period} · {p.view.scenario.summary.shiftCount} ture · <span className="font-medium text-amber-700">SANDBOX</span> — lucrezi pe o copie</p>
          {p.scenario.notes && <p className="mt-1 text-sm text-slate-600">{p.scenario.notes}</p>}
          {p.settings.appliedAt && <p className="mt-1 text-xs font-medium text-emerald-700">✓ {ro.sim.applyReal.appliedAt} {new Date(p.settings.appliedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/simulation/compare?a=${p.scenario.id}&b=real`} className="btn-secondary">{ro.sim.compare}</Link>
          <button className="btn-secondary" disabled={pending || p.history.length === 0} onClick={() => run(() => undoSimChange(p.scenario.id))}>↶ {ro.sim.undo}</button>
          <button className="btn-secondary border-emerald-300 text-emerald-800 hover:bg-emerald-50" disabled={pending} onClick={() => setApplyOpen(true)}>{ro.sim.applyReal.button}</button>
        </div>
      </div>

      {applyOpen && <ApplyRealDialog name={p.scenario.name} onClose={() => setApplyOpen(false)} onConfirm={(typed) => { setApplyOpen(false); run(() => applyScenarioToReal(p.scenario.id, typed)); }} />}

      {flash && (
        <div className={clsx("rounded-lg px-4 py-2 text-sm", flash.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800")}>
          {flash.kind === "ok" ? "✓ " : "⚠ "}
          {flash.text}
        </div>
      )}

      <div className={clsx("transition-opacity", pending && "opacity-60")}>
        <KpiRow view={p.view} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {label}
            {k === "optimize" && pendingSugg > 0 && <span className="ml-1.5 rounded-full bg-violet-600 px-1.5 text-[11px] text-white">{pendingSugg}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
          <div className="space-y-5">
            <ChangePanel {...p} pending={pending} onApply={apply} onPreview={doPreview} />
            {preview && <ImpactBox title={ro.sim.preview} messages={preview.messages} impact={preview.impact} />}
            <SkillGapPanel scenarioId={p.scenario.id} employees={p.employees} departments={p.departments} levels={p.levels} />
            <section className="card card-pad">
              <h2 className="h2 mb-2">{ro.sim.history}</h2>
              {p.history.length === 0 ? (
                <p className="muted">{ro.sim.noChanges}</p>
              ) : (
                <ol className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
                  {p.history.map((h, i) => (
                    <li key={h.id} className={clsx("rounded-md px-2 py-1", i === 0 ? "bg-brand-50" : "bg-slate-50")}>
                      <span className="mr-1 text-xs text-slate-400">{new Date(h.createdAt).toLocaleTimeString("ro-RO", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit" })}</span>
                      {h.message}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <div className="min-w-0 space-y-5">
            <section className="card card-pad">
              <h2 className="h2 mb-2">{ro.sim.coverageByDept}</h2>
              <DeptCoverageChart view={p.view} />
            </section>
            <section className="card card-pad">
              <h2 className="h2 mb-3">{ro.sim.coverageHeatmap} <span className="text-xs font-normal text-slate-500">(medie pe perioadă, %)</span></h2>
              <CoverageHeatmap view={p.view} departments={p.departments} />
            </section>
            <IssuesPanel view={p.view} />
          </div>
        </div>
      )}

      {tab === "calendar" && <ScenarioCalendar calendar={p.calendar} departments={p.departments} teams={p.teams} pending={pending} onChanges={applyBatch} />}

      {tab === "optimize" && (
        <div className="grid gap-5 2xl:grid-cols-2">
          <OptimizerPanel scenarioId={p.scenario.id} departments={p.departments} employees={p.employees} pending={pending} onApply={applyBatch} onFlash={showFlash} />
          <SuggestionsPanel scenarioId={p.scenario.id} suggestions={p.suggestions} pending={pending} onApply={(id) => run(() => applySuggestion(id))} onDismiss={(id) => run(async () => ({ ...(await dismissSuggestion(id)), message: ro.sim.statuses.DISMISSED }))} />
        </div>
      )}

      {tab === "whatif" && (
        <WhatIfPanel
          key={JSON.stringify(p.settings.rules)}
          settings={p.settings}
          calendar={p.calendar}
          departments={p.departments}
          skills={p.skills}
          levels={p.levels}
          pending={pending}
          onApply={applyBatch}
          onFlash={(ok, text) => setFlash({ kind: ok ? "ok" : "err", text })}
        />
      )}

      {tab === "fairness" && <FairnessPanel view={p.view} departments={p.departments} />}
    </div>
  );
}

function ApplyRealDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: (typed: string) => void }) {
  const [typed, setTyped] = useState("");
  const t = ro.sim.applyReal;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="card card-pad w-full max-w-lg space-y-3">
        <h2 className="h2">{t.title}</h2>
        <p className="text-sm text-slate-600">{t.text}</p>
        <div>
          <label className="label">{t.confirmLabel}: <span className="normal-case text-slate-800">„{name}”</span></label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{ro.common.cancel}</button>
          <button className="btn-danger" disabled={typed.trim() !== name.trim()} onClick={() => onConfirm(typed)}>{t.confirm}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- change forms

function ChangePanel(p: Props & { pending: boolean; onApply: (c: unknown) => void; onPreview: (c: unknown) => void }) {
  const tabs = [
    { k: "hours", label: ro.sim.changeHours },
    { k: "swap", label: ro.sim.swapTeams },
    { k: "move", label: ro.sim.moveEmployee },
    { k: "level", label: ro.sim.setLevel },
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]["k"]>("hours");
  const [dept, setDept] = useState(p.departments.find((d) => d.code === "RMP")?.id ?? p.departments[0].id);
  const deptTeams = p.teams.filter((t) => t.departmentId === dept);
  const deptEmps = p.employees.filter((e) => e.departmentId === dept);

  const [hours, setHours] = useState({ teamId: "", fromStart: "", startTime: "05:00", endTime: "13:00" });
  const [swap, setSwap] = useState({ a: "", b: "" });
  const [move, setMove] = useState({ employeeId: "", teamId: "" });
  const [lvl, setLvl] = useState({ employeeId: "", levelId: "" });

  let change: unknown = null;
  if (tab === "hours") change = { type: "CHANGE_SHIFT_HOURS", departmentId: dept, teamId: hours.teamId || null, fromStart: hours.fromStart || null, startTime: hours.startTime, endTime: hours.endTime };
  if (tab === "swap" && swap.a && swap.b) change = { type: "SWAP_TEAMS", teamAId: swap.a, teamBId: swap.b };
  if (tab === "move" && move.employeeId && move.teamId) change = { type: "MOVE_EMPLOYEE_TEAM", employeeId: move.employeeId, teamId: move.teamId };
  if (tab === "level" && lvl.employeeId && lvl.levelId) change = { type: "SET_EMPLOYEE_LEVEL", employeeId: lvl.employeeId, levelId: lvl.levelId };

  return (
    <section className="card card-pad space-y-3">
      <h2 className="h2">{ro.sim.changes}</h2>
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", tab === t.k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
            {t.label}
          </button>
        ))}
      </div>
      <div>
        <label className="label">{ro.sim.department}</label>
        <select className="input" value={dept} onChange={(e) => { setDept(e.target.value); setSwap({ a: "", b: "" }); setMove({ employeeId: "", teamId: "" }); setHours({ ...hours, teamId: "", fromStart: "" }); }}>
          {p.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {tab === "hours" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><label className="label">{ro.sim.team}</label>
            <select className="input" value={hours.teamId} onChange={(e) => setHours({ ...hours, teamId: e.target.value })}>
              <option value="">{ro.common.all}</option>
              {deptTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className="label">{ro.sim.fromStart}</label>
            <select className="input" value={hours.fromStart} onChange={(e) => setHours({ ...hours, fromStart: e.target.value })}>
              <option value="">{ro.common.all}</option>
              {(p.startTimes[dept] ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label className="label">{ro.sim.newStart}</label><input type="time" className="input" value={hours.startTime} onChange={(e) => setHours({ ...hours, startTime: e.target.value })} /></div>
          <div><label className="label">{ro.sim.newEnd}</label><input type="time" className="input" value={hours.endTime} onChange={(e) => setHours({ ...hours, endTime: e.target.value })} /></div>
          <div className="col-span-2 flex flex-wrap gap-1 text-xs">
            {[["05:00", "13:00"], ["06:00", "18:00"], ["18:00", "06:00"], ["13:00", "21:00"]].map(([a, b]) => (
              <button key={a + b} className="rounded bg-slate-100 px-2 py-0.5 hover:bg-slate-200" onClick={() => setHours({ ...hours, startTime: a, endTime: b })}>{a}–{b}</button>
            ))}
          </div>
        </div>
      )}
      {tab === "swap" && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">{ro.sim.teamA}</label>
            <select className="input" value={swap.a} onChange={(e) => setSwap({ ...swap, a: e.target.value })}>
              <option value="">—</option>{deptTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          <div><label className="label">{ro.sim.teamB}</label>
            <select className="input" value={swap.b} onChange={(e) => setSwap({ ...swap, b: e.target.value })}>
              <option value="">—</option>{deptTeams.filter((t) => t.id !== swap.a).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
        </div>
      )}
      {tab === "move" && (
        <div className="space-y-2">
          <div><label className="label">{ro.sim.employee}</label>
            <select className="input" value={move.employeeId} onChange={(e) => setMove({ ...move, employeeId: e.target.value })}>
              <option value="">—</option>
              {deptEmps.map((e) => <option key={e.id} value={e.id}>{e.name} · {p.teams.find((t) => t.id === e.teamId)?.name} · {e.level}</option>)}
            </select></div>
          <div><label className="label">{ro.sim.targetTeam}</label>
            <select className="input" value={move.teamId} onChange={(e) => setMove({ ...move, teamId: e.target.value })}>
              <option value="">—</option>
              {p.departments.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {p.teams.filter((t) => t.departmentId === d.id).map((t) => <option key={t.id} value={t.id}>{d.code} · {t.name}</option>)}
                </optgroup>
              ))}
            </select></div>
        </div>
      )}
      {tab === "level" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><label className="label">{ro.sim.employee}</label>
            <select className="input" value={lvl.employeeId} onChange={(e) => setLvl({ ...lvl, employeeId: e.target.value })}>
              <option value="">—</option>
              {deptEmps.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.level}</option>)}
            </select></div>
          <div className="col-span-2"><label className="label">{ro.profile.level}</label>
            <select className="input" value={lvl.levelId} onChange={(e) => setLvl({ ...lvl, levelId: e.target.value })}>
              <option value="">—</option>{p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></div>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" disabled={p.pending || !change} onClick={() => p.onPreview(change)}>{ro.sim.preview}</button>
        <button className="btn-primary flex-1" disabled={p.pending || !change} onClick={() => p.onApply(change)}>{ro.sim.apply}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- impact

type Impact = { summary?: Comparison["summary"]; byDept?: Comparison["byDept"]; messages?: string[] };

function ImpactLines({ impact }: { impact: Impact }) {
  if (!impact.summary) return null;
  const rows: [string, keyof Comparison["summary"], boolean][] = [
    [ro.sim.avgCoverage, "avgCoverage", true],
    [ro.sim.understaffed, "understaffedSlots", false],
    [ro.sim.overtime, "totalOvertime", false],
    [ro.sim.violations, "violationCount", false],
    [ro.sim.mismatches, "mismatchCount", false],
  ];
  const changedDepts = (impact.byDept ?? []).filter((d) => d.delta !== 0);
  return (
    <div className="space-y-1 text-xs">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {rows.map(([label, k, hib]) => {
          const d = impact.summary![k];
          const good = d.delta === 0 ? null : hib ? d.delta > 0 : d.delta < 0;
          return (
            <div key={k} className="flex justify-between">
              <span className="text-slate-500">{label}</span>
              <span className={clsx("tabular-nums", good === null ? "text-slate-500" : good ? "text-emerald-700" : "text-red-700")}>
                {d.a} → {d.b}
              </span>
            </div>
          );
        })}
      </div>
      {changedDepts.length > 0 && (
        <div className="pt-1 text-slate-600">
          {changedDepts.map((d) => <div key={d.departmentId}>{d.name}: {d.a}% → <b>{d.b}%</b></div>)}
        </div>
      )}
    </div>
  );
}

function ImpactBox({ title, messages, impact }: { title: string; messages: string[]; impact: Comparison }) {
  return (
    <section className="card card-pad space-y-2 border-brand-500">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="text-xs text-slate-700">{messages.map((m) => <li key={m}>• {m}</li>)}</ul>
      <ImpactLines impact={impact} />
    </section>
  );
}

// ---------------------------------------------------------------- skill gap

function SkillGapPanel({ scenarioId, employees, departments, levels }: { scenarioId: string; employees: Emp[]; departments: Dept[]; levels: { id: string; name: string }[] }) {
  const [dept, setDept] = useState(departments[0].id);
  const [emp, setEmp] = useState("");
  const [target, setTarget] = useState("next");
  const [gap, setGap] = useState<SkillGap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = useMemo(() => employees.filter((e) => e.departmentId === dept), [employees, dept]);
  return (
    <section className="card card-pad space-y-2">
      <h2 className="h2">{ro.sim.skillGap}</h2>
      <select className="input" value={dept} onChange={(e) => { setDept(e.target.value); setEmp(""); setGap(null); }}>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)}>
        <option value="">{ro.sim.employee}…</option>
        {list.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.level}</option>)}
      </select>
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="next">{ro.sim.gapNextLevel}</option>
        <optgroup label={ro.profile.targetLevel}>{levels.map((l) => <option key={l.id} value={`L:${l.id}`}>{l.name}</option>)}</optgroup>
        <optgroup label={ro.sim.gapDepartment}>{departments.map((d) => <option key={d.id} value={`D:${d.id}`}>{d.name}</option>)}</optgroup>
      </select>
      <button className="btn-secondary w-full" disabled={!emp || pending}
        onClick={() => start(async () => {
          const t = target.startsWith("L:") ? { targetLevelId: target.slice(2) } : target.startsWith("D:") ? { targetDepartmentId: target.slice(2) } : {};
          const r = await skillGapAction(scenarioId, emp, t);
          if (r.ok) { setGap(r.gap); setErr(null); } else setErr(r.error);
        })}>
        {ro.sim.gapRun}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {gap && (
        <div className="space-y-1 pt-1 text-sm">
          <div className="text-xs text-slate-500">{gap.employeeName}: {gap.currentLevel} → <b>{gap.targetLevel ?? gap.targetDepartment}</b></div>
          {gap.items.map((i) => (
            <div key={i.skillId} className={clsx("flex justify-between rounded px-2 py-1 text-xs", i.ok ? "bg-emerald-50" : "bg-red-50")}>
              <span>{i.ok ? "✓" : "✗"} {i.skillName}{i.expired ? " (expirat)" : ""}</span><span>{i.current}/{i.required}</span>
            </div>
          ))}
          {gap.targetLevel && <div className={clsx("flex justify-between rounded px-2 py-1 text-xs", gap.monthsOk ? "bg-emerald-50" : "bg-red-50")}><span>{gap.monthsOk ? "✓" : "✗"} {ro.profile.months}</span><span>{gap.monthsInLevel}/{gap.monthsRequired} luni</span></div>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- AI suggestions

function SuggestionsPanel({ scenarioId, suggestions, pending, onApply, onDismiss }: { scenarioId: string; suggestions: Suggestion[]; pending: boolean; onApply: (id: string) => void; onDismiss: (id: string) => void }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | null>(null);
  const [reply, setReply] = useState<{ source: string; text: string; tools?: string[] } | null>(null);
  const ask = async () => {
    setBusy(true);
    setReply(null);
    try {
      const res = await fetch("/api/admin/sim/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId, prompt, conversationId: conv }) });
      const j = await res.json();
      if (!res.ok) setReply({ source: "ERR", text: j.error ?? ro.common.errorGeneric });
      else {
        setConv(j.conversationId);
        setReply({ source: j.source, text: j.reply, tools: j.toolCalls?.map((t: { name: string }) => t.name) });
        setPrompt("");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad space-y-3 border-violet-200">
      <div className="flex items-center justify-between">
        <h2 className="h2">✦ {ro.sim.aiSuggestions}</h2>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={ro.sim.aiPromptPlaceholder} onKeyDown={(e) => e.key === "Enter" && !busy && ask()} />
        <button className="btn-primary whitespace-nowrap bg-violet-600 hover:bg-violet-700" disabled={busy} onClick={ask}>{busy ? ro.assistant.thinking : ro.sim.askAi}</button>
      </div>
      {reply && (
        <div className={clsx("rounded-lg px-3 py-2 text-sm", reply.source === "ERR" ? "bg-red-50 text-red-800" : "bg-violet-50 text-slate-800")}>
          <p className="whitespace-pre-wrap">{reply.text}</p>
          {reply.tools && reply.tools.length > 0 && <p className="mt-1 text-xs text-slate-500">{ro.assistant.toolsUsed}: {reply.tools.join(", ")}</p>}
        </div>
      )}
      {suggestions.length === 0 && <p className="muted">{ro.sim.noSuggestions}</p>}
      <div className="space-y-2">
        {suggestions.map((s) => {
          const imp = (s.estimatedImpact ?? {}) as Impact;
          return (
            <div key={s.id} className={clsx("rounded-lg border p-3", s.status === "PENDING" ? "border-violet-200 bg-white" : "border-slate-200 bg-slate-50 opacity-75")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm">{s.rationale}</p>
                <span className="flex shrink-0 gap-1">
                  <span className="badge bg-violet-100 text-violet-800">{s.source === "AI" ? "AI" : s.source === "OPTIMIZER" ? "Optimizator" : s.source}</span>
                  <span className={`badge ${STATUS_STYLES[s.status]}`}>{ro.sim.statuses[s.status as keyof typeof ro.sim.statuses]}</span>
                </span>
              </div>
              {imp.messages && <ul className="mt-1 text-xs text-slate-600">{imp.messages.map((m) => <li key={m}>→ {m}</li>)}</ul>}
              <div className="mt-2 rounded bg-slate-50 p-2">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{ro.sim.estimatedImpact}</div>
                <ImpactLines impact={imp} />
              </div>
              {s.status === "PENDING" && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary btn-sm" disabled={pending} onClick={() => onApply(s.id)}>{ro.sim.applySuggestion}</button>
                  <button className="btn-ghost btn-sm" disabled={pending} onClick={() => onDismiss(s.id)}>{ro.sim.dismiss}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- issues

function IssuesPanel({ view }: { view: SimView }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = Object.entries(
    view.scenario.violations.reduce<Record<string, string[]>>((acc, v) => {
      (acc[v.type] ??= []).push(v.message);
      return acc;
    }, {}),
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card card-pad">
        <h2 className="h2 mb-2">{ro.sim.violations} ({view.scenario.violations.length})</h2>
        {groups.length === 0 && <p className="muted">✓ 0</p>}
        <ul className="space-y-1">
          {groups.map(([type, msgs]) => (
            <li key={type}>
              <button className="flex w-full justify-between rounded-md bg-red-50 px-2.5 py-1.5 text-left text-sm text-red-900" onClick={() => setOpen(open === type ? null : type)}>
                <span>⚠ {ro.sim.violationTypes[type as keyof typeof ro.sim.violationTypes] ?? type}</span>
                <b>{msgs.length}</b>
              </button>
              {open === type && <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto pl-3 text-xs text-slate-700">{[...new Set(msgs)].map((m) => <li key={m}>• {m}</li>)}</ul>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card card-pad space-y-3">
        <div>
          <h2 className="h2 mb-2">{ro.sim.expiring} ({view.scenario.expiringCertifications.length})</h2>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
            {view.scenario.expiringCertifications.map((c) => (
              <li key={c.employeeId + c.skillId} className={c.expired ? "text-red-700" : "text-amber-800"}>
                {c.name}: {c.skillName} · {new Date(c.expiresAt).toLocaleDateString("ro-RO")}{c.expired ? ` (${ro.profile.expired.toLowerCase()})` : ""}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="h2 mb-2">{ro.sim.overtime}</h2>
          <ul className="space-y-0.5 text-xs">
            {view.scenario.topHours.filter((h) => h.overtime > 0).slice(0, 8).map((h) => (
              <li key={h.employeeId} className="flex justify-between"><span>{h.name}</span><span className="tabular-nums">{h.total}h · <b>+{h.overtime}h</b></span></li>
            ))}
            {view.scenario.topHours.every((h) => h.overtime === 0) && <li className="text-slate-500">0</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
