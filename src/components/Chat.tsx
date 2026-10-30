"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ro } from "@/lib/i18n/ro";

type Msg =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string; tools?: string[] }
  | { kind: "error"; text: string }
  | { kind: "draft"; messageId: string; type: string; summary: string; details: string; status: "PENDING" | "CONFIRMED" | "CANCELLED" };

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { kind: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conv, message: text, mode: "EMPLOYEE" }) });
      const j = await res.json();
      if (j.conversationId) setConv(j.conversationId);
      if (!res.ok) {
        setMsgs((m) => [...m, { kind: "error", text: j.error ?? ro.common.errorGeneric }]);
        return;
      }
      setMsgs((m) => [
        ...m,
        { kind: "bot", text: j.reply, tools: j.toolCalls?.map((t: { name: string }) => t.name) },
        ...(j.pendingRequest && j.pendingRequestMessageId
          ? [{ kind: "draft" as const, messageId: j.pendingRequestMessageId, status: "PENDING" as const, ...j.pendingRequest }]
          : []),
      ]);
    } catch {
      setMsgs((m) => [...m, { kind: "error", text: ro.common.errorGeneric }]);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (messageId: string, action: "confirm" | "cancel") => {
    const res = await fetch("/api/ai/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, action }) });
    const j = await res.json();
    setMsgs((m) => [
      ...m.map((x) => (x.kind === "draft" && x.messageId === messageId ? { ...x, status: (j.status ?? x.status) as "CONFIRMED" | "CANCELLED" } : x)),
      res.ok ? { kind: "bot" as const, text: action === "confirm" ? ro.assistant.confirmed : ro.assistant.cancelled } : { kind: "error" as const, text: j.error },
    ]);
  };

  return (
    <div className="card flex h-[calc(100vh-170px)] min-h-[480px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-md pt-10 text-center">
            <div className="text-4xl">✈</div>
            <p className="mt-2 text-slate-600">{ro.assistant.subtitle}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {ro.assistant.examples.map((e) => (
                <button key={e} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-brand-500 hover:text-brand-700" onClick={() => send(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.kind === "user") return <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">{m.text}</div>;
          if (m.kind === "error") return <div key={i} className="max-w-[80%] rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-800">⚠ {m.text}</div>;
          if (m.kind === "bot")
            return (
              <div key={i} className="max-w-[80%]">
                <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800">{m.text}</div>
                {m.tools && m.tools.length > 0 && <div className="mt-0.5 pl-2 text-[11px] text-slate-400">{ro.assistant.toolsUsed}: {[...new Set(m.tools)].join(", ")}</div>}
              </div>
            );
          return (
            <div key={i} className={clsx("max-w-[80%] rounded-xl border-2 p-4", m.status === "PENDING" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">{ro.assistant.confirmTitle}</div>
              <div className="mt-1 font-medium">{ro.requests.types[m.type as keyof typeof ro.requests.types] ?? m.type}</div>
              <div className="text-sm text-slate-700">{m.summary}</div>
              {m.details !== m.summary && <div className="mt-1 text-xs text-slate-500">{m.details}</div>}
              {m.status === "PENDING" ? (
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => decide(m.messageId, "confirm")}>{ro.common.confirm}</button>
                  <button className="btn-secondary btn-sm" onClick={() => decide(m.messageId, "cancel")}>{ro.common.cancel}</button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-500">{m.status === "CONFIRMED" ? `✓ ${ro.assistant.confirmed}` : ro.assistant.cancelled}</div>
              )}
            </div>
          );
        })}
        {busy && <div className="text-sm text-slate-500">{ro.assistant.thinking}</div>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={ro.assistant.placeholder} disabled={busy} />
        <button className="btn-primary" disabled={busy || !input.trim()}>{ro.assistant.send}</button>
        <button type="button" className="btn-ghost" onClick={() => { setMsgs([]); setConv(null); }}>{ro.assistant.newChat}</button>
      </form>
    </div>
  );
}
