"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { resetSimChat, startScenarioChat, type SimChatMsg } from "@/app/actions/simulation";
import { ro } from "@/lib/i18n/ro";

type Msg = SimChatMsg | { id: string; kind: "error"; text: string; at: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("ro-RO", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit" });

/** Admin chat with the AI about one scenario. History is saved on the server (one conversation per scenario). */
/** `scenarioAsk` changes each time "Suggest me a scenario" is pressed (outside this component). */
export default function SimChat({ scenarioId, initial, scenarioAsk = 0 }: { scenarioId: string; initial: SimChatMsg[]; scenarioAsk?: number }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [askReplace, setAskReplace] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const input$ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs, busy]);
  useEffect(() => {
    if (!confirmNew) return;
    const t = setTimeout(() => setConfirmNew(false), 4000);
    return () => clearTimeout(t);
  }, [confirmNew]);

  const startScenario = async () => {
    setAskReplace(false);
    setInfo(null);
    setBusy(true);
    try {
      const r = await startScenarioChat(scenarioId);
      if (r.ok) setMsgs(r.messages);
      else setInfo(r.error);
    } finally {
      setBusy(false);
      input$.current?.focus();
    }
  };
  // "Suggest me a scenario" pressed: confirm first if there is a conversation to lose
  const lastAsk = useRef(scenarioAsk);
  useEffect(() => {
    if (scenarioAsk === lastAsk.current) return;
    lastAsk.current = scenarioAsk;
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (msgs.length > 0) setAskReplace(true);
    else startScenario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioAsk]);

  const now = () => new Date().toISOString();
  const send = async (raw: string) => {
    if (busy) return;
    const text = raw.trim() || ro.sim.chat.defaultQuestion;
    setInfo(null);
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, kind: "user", text, at: now() }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sim/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId, prompt: text }) });
      const j = await res.json().catch(() => ({ error: `${ro.common.errorGeneric} (HTTP ${res.status})` }));
      if (!res.ok) {
        setMsgs((m) => [...m, { id: `err-${Date.now()}`, kind: "error", text: [j.error ?? ro.common.errorGeneric, j.detail].filter(Boolean).join("\n"), at: now() }]);
      } else if (j.source === "OPTIMIZER") {
        setMsgs((m) => [...m, { id: `n-${Date.now()}`, kind: "notice", text: j.reply, at: now() }]);
      } else {
        setMsgs((m) => [...m, { id: `b-${Date.now()}`, kind: "bot", text: j.reply, tools: j.toolCalls?.map((t: { name: string }) => t.name), at: now() }]);
      }
      router.refresh(); // new suggestions
    } catch {
      setMsgs((m) => [...m, { id: `err-${Date.now()}`, kind: "error", text: ro.common.errorGeneric, at: now() }]);
    } finally {
      setBusy(false);
    }
  };

  const newChat = async () => {
    if (!confirmNew) return setConfirmNew(true);
    setConfirmNew(false);
    const r = await resetSimChat(scenarioId);
    if (r.ok) {
      setMsgs([]);
      setInfo(r.message);
    } else setInfo(r.error);
  };

  return (
    <section ref={box} className="card flex h-[calc(100vh-260px)] min-h-[520px] flex-col border-violet-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="h2">✦ {ro.sim.chat.title}</h2>
          <p className="muted text-xs">{ro.sim.chat.intro}</p>
        </div>
        <button
          className={clsx("btn-sm whitespace-nowrap", confirmNew ? "btn-primary bg-red-600 hover:bg-red-700" : "btn-secondary")}
          disabled={busy || (msgs.length === 0 && !confirmNew)}
          onClick={newChat}
        >
          {confirmNew ? ro.sim.chat.confirmNew : `↺ ${ro.sim.chat.newChat}`}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">✓ {info}</p>}
        {askReplace && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="flex-1">{ro.sim.chat.replaceConfirm}</span>
            <button className="btn-primary btn-sm bg-violet-600 hover:bg-violet-700" disabled={busy} onClick={startScenario}>{ro.sim.chat.yes}</button>
            <button className="btn-ghost btn-sm" onClick={() => setAskReplace(false)}>{ro.sim.chat.no}</button>
          </div>
        )}
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="muted">{ro.sim.chat.empty}</p>
            <div className="flex flex-wrap gap-2">
              {ro.sim.chat.examples.map((e) => (
                <button key={e} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs text-violet-800 hover:bg-violet-100" disabled={busy} onClick={() => send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.kind === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white">
                <p className="whitespace-pre-wrap">{m.text}</p>
                <p className="mt-0.5 text-right text-[10px] text-violet-200">{time(m.at)}</p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div
                className={clsx(
                  "max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm",
                  m.kind === "bot" && "bg-slate-100 text-slate-800",
                  m.kind === "notice" && "border border-amber-200 bg-amber-50 text-amber-900",
                  m.kind === "error" && "bg-red-50 text-red-800",
                )}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {time(m.at)}
                  {m.kind === "bot" && m.tools && m.tools.length > 0 && ` · ${ro.assistant.toolsUsed}: ${[...new Set(m.tools)].join(", ")}`}
                </p>
              </div>
            </div>
          ),
        )}
        {busy && <p className="muted text-sm">{ro.assistant.thinking}</p>}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 border-t border-slate-100 px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input ref={input$} className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={ro.sim.aiPromptPlaceholder} disabled={busy} />
        <button className="btn-primary whitespace-nowrap bg-violet-600 hover:bg-violet-700" disabled={busy}>
          {busy ? ro.assistant.thinking : input.trim() ? ro.sim.chat.send : ro.sim.askAi}
        </button>
      </form>
    </section>
  );
}
