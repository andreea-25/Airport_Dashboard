import { redirect } from "next/navigation";
import clsx from "clsx";
import { requireSession } from "@/lib/auth";
import { getMyCareerGap, getMyProfile } from "@/lib/services/employee";
import { ro } from "@/lib/i18n/ro";
import { fmt } from "@/lib/time";
import SkillGapView from "@/components/SkillGapView";

export default async function ProfilePage() {
  const s = await requireSession();
  if (!s.employeeId) redirect("/admin/today");
  const [me, gap] = await Promise.all([getMyProfile(s), getMyCareerGap(s)]);
  const now = Date.now();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="card card-pad flex flex-wrap items-center gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#0b1f3a] text-xl font-semibold text-amber-300">
          {me.firstName[0]}
          {me.lastName[0]}
        </div>
        <div className="flex-1">
          <h1 className="h1">{me.firstName} {me.lastName}</h1>
          <p className="muted">{me.department.name} · {me.team?.name ?? ro.common.none} · <b className="text-slate-800">{me.level.name}</b></p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">{ro.profile.hireDate}</dt>
          <dd>{fmt(me.hireDate, "dd.MM.yyyy")}</dd>
          <dt className="text-slate-500">{ro.profile.levelSince}</dt>
          <dd>{fmt(me.levelSince, "dd.MM.yyyy")}</dd>
        </dl>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card card-pad">
          <h2 className="h2 mb-3">{ro.profile.skills}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{ro.profile.skill}</th>
                <th>{ro.profile.type}</th>
                <th>{ro.profile.proficiency}</th>
                <th>{ro.profile.expires}</th>
              </tr>
            </thead>
            <tbody>
              {me.skills.map((sk) => {
                const exp = sk.expiresAt?.getTime();
                const state = !exp ? null : exp < now ? "expired" : exp < now + 30 * 86400000 ? "soon" : "ok";
                return (
                  <tr key={sk.skillId}>
                    <td>{sk.skill.name}</td>
                    <td className="text-slate-500">{ro.profile[sk.skill.type]}</td>
                    <td>{"●".repeat(sk.proficiency)}<span className="text-slate-300">{"●".repeat(3 - sk.proficiency)}</span></td>
                    <td>
                      {sk.expiresAt ? (
                        <span className={clsx("badge", state === "expired" ? "bg-red-100 text-red-800" : state === "soon" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700")}>
                          {fmt(sk.expiresAt, "dd.MM.yyyy")}
                          {state === "expired" ? ` · ${ro.profile.expired}` : state === "soon" ? ` · ${ro.profile.expiresSoon}` : ""}
                        </span>
                      ) : (
                        ro.common.none
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{ro.profile.englishNote}</p>
        </section>
        <section className="card card-pad">
          <h2 className="h2 mb-3">{ro.profile.career}</h2>
          <SkillGapView gap={gap} />
        </section>
      </div>
    </div>
  );
}
