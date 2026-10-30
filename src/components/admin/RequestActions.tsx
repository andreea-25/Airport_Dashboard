"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveRequest } from "@/app/actions/requests";
import { ro } from "@/lib/i18n/ro";

export default function RequestActions({ id, status, response }: { id: string; status: string; response: string | null }) {
  const [text, setText] = useState(response ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (s: "IN_REVIEW" | "APPROVED" | "REJECTED") => start(async () => { await resolveRequest({ id, status: s, response: text }); router.refresh(); });
  return (
    <div className="space-y-2">
      <textarea className="input min-h-[60px]" placeholder={ro.requests.responsePlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {status === "SUBMITTED" && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => go("IN_REVIEW")}>{ro.requests.markInReview}</button>}
        <button className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700" disabled={pending} onClick={() => go("APPROVED")}>{ro.requests.approve}</button>
        <button className="btn-danger btn-sm" disabled={pending} onClick={() => go("REJECTED")}>{ro.requests.reject}</button>
      </div>
    </div>
  );
}
