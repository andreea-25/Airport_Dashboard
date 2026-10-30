"use client";
import { useState, useTransition } from "react";
import { addComment, deleteComment } from "@/app/actions/comments";
import { ro } from "@/lib/i18n/ro";

type C = { id: string; body: string; createdAt: string; parentId: string | null; authorId: string; authorName: string; authorIsAdmin: boolean };

export default function Comments({ shiftId, comments, userId, isAdmin }: { shiftId: string; comments: C[]; userId: string; isAdmin: boolean }) {
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const roots = comments.filter((c) => !c.parentId);
  const now = Date.now();

  const submit = (text: string, parentId?: string) =>
    start(async () => {
      setError(null);
      const r = await addComment(shiftId, text, parentId);
      if (r.error) setError(r.error);
      else {
        setBody("");
        setReply("");
        setReplyTo(null);
      }
    });

  const Item = ({ c }: { c: C }) => {
    const canDelete = c.authorId === userId && now - new Date(c.createdAt).getTime() < 10 * 60_000;
    return (
      <div className="rounded-lg bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            <span className="font-medium text-slate-800">{c.authorName}</span>
            {c.authorIsAdmin && <span className="badge ml-1 bg-slate-900 text-white">admin</span>}
            {" · "}
            {new Date(c.createdAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" })}
          </span>
          <span className="flex gap-2">
            {isAdmin && !c.parentId && (
              <button className="hover:text-brand-600" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>{ro.comments.reply}</button>
            )}
            {canDelete && (
              <button className="hover:text-red-600" onClick={() => start(async () => { const r = await deleteComment(c.id); if (r.error) setError(r.error); })}>
                {ro.common.delete}
              </button>
            )}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{c.body}</p>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {roots.length === 0 && <p className="muted">{ro.comments.none}</p>}
      {roots.map((c) => (
        <div key={c.id} className="space-y-2">
          <Item c={c} />
          <div className="ml-6 space-y-2 border-l-2 border-slate-200 pl-3">
            {comments.filter((r) => r.parentId === c.id).map((r) => <Item key={r.id} c={r} />)}
            {replyTo === c.id && (
              <div className="flex gap-2">
                <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={ro.comments.replyPlaceholder} />
                <button className="btn-primary" disabled={pending || !reply.trim()} onClick={() => submit(reply, c.id)}>{ro.comments.reply}</button>
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="space-y-2 pt-2">
        <textarea className="input min-h-[72px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder={ro.comments.placeholder} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{ro.comments.deleteWindow}</span>
          <button className="btn-primary" disabled={pending || !body.trim()} onClick={() => submit(body)}>{ro.comments.add}</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
