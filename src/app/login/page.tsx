import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ro } from "@/lib/i18n/ro";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect("/");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1f3a] p-12 text-white lg:flex">
        <div className="flight-board text-sm uppercase tracking-[0.3em] text-amber-300">CRA · Craiova</div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight">{ro.app.name}</h1>
          <p className="mt-3 max-w-md text-slate-300">{ro.app.tagline}</p>
        </div>
        <div className="flight-board grid grid-cols-4 gap-2 text-xs text-amber-200/90">
          {["SEC 05:00", "RMP 06:00", "CHK 05:00", "GTE 14:00", "BAG 06:00", "PRM 06:00", "OCC 22:00", "MNT 22:00"].map((t) => (
            <div key={t} className="rounded bg-white/5 px-2 py-1.5 text-center">{t}</div>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="card card-pad w-full max-w-sm">
          <h2 className="h1 mb-6">{ro.auth.title}</h2>
          <LoginForm />
          <p className="mt-6 text-xs text-slate-500">{ro.auth.demoHint}</p>
        </div>
      </section>
    </main>
  );
}
