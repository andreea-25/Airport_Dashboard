"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { ro } from "@/lib/i18n/ro";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">{ro.auth.email}</label>
        <input id="email" name="email" type="email" required className="input" autoComplete="username" />
      </div>
      <div>
        <label className="label" htmlFor="password">{ro.auth.password}</label>
        <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? ro.common.loading : ro.auth.submit}</button>
    </form>
  );
}
