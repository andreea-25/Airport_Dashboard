"use client";
import { useActionState, useState } from "react";
import { submitRequest } from "@/app/actions/requests";
import { ro } from "@/lib/i18n/ro";

export default function NewRequestForm() {
  const [state, action, pending] = useActionState(submitRequest, undefined);
  const [type, setType] = useState("LEAVE");
  return (
    <form action={action} className="space-y-3" key={state && "ok" in state ? Date.now() : "form"}>
      <div>
        <label className="label">{ro.requests.type}</label>
        <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(ro.requests.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {(type === "LEAVE" || type === "SHIFT_SWAP") && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">{ro.requests.fromLabel}</label><input type="date" name="from" className="input" /></div>
          <div><label className="label">{ro.requests.toLabel}</label><input type="date" name="to" className="input" /></div>
        </div>
      )}
      <div>
        <label className="label">{ro.requests.descriptionLabel}</label>
        <textarea name="details" className="input min-h-[80px]" required />
      </div>
      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm text-emerald-700">✓ {ro.assistant.confirmed}</p>}
      <button className="btn-primary w-full" disabled={pending}>{ro.requests.submit}</button>
    </form>
  );
}
