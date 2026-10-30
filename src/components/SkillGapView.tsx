import clsx from "clsx";
import type { SkillGap } from "@/lib/sim/scenario";
import { ro } from "@/lib/i18n/ro";

export default function SkillGapView({ gap }: { gap: SkillGap }) {
  if (!gap.targetLevel && gap.items.length === 0) return <p className="muted">{ro.profile.topLevel}</p>;
  const done = gap.items.filter((i) => i.ok).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span>
          {gap.currentLevel} → <b>{gap.targetLevel ?? gap.targetDepartment}</b>
        </span>
        <span className="text-slate-500">{done}/{gap.items.length}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-500" style={{ width: `${gap.items.length ? (done / gap.items.length) * 100 : 100}%` }} />
      </div>
      <ul className="space-y-1.5 text-sm">
        {gap.items.map((i) => (
          <li key={i.skillId} className={clsx("flex items-center justify-between rounded-md px-2.5 py-1.5", i.ok ? "bg-emerald-50" : "bg-red-50")}>
            <span>
              {i.ok ? "✓" : "✗"} {i.skillName}
              {i.expired && <span className="ml-1 text-xs text-red-700">({ro.profile.expired})</span>}
            </span>
            <span className="text-xs text-slate-600">
              {i.current}/{i.required}
            </span>
          </li>
        ))}
        {gap.targetLevel && (
          <li className={clsx("flex items-center justify-between rounded-md px-2.5 py-1.5", gap.monthsOk ? "bg-emerald-50" : "bg-red-50")}>
            <span>{gap.monthsOk ? "✓" : "✗"} {ro.profile.months}</span>
            <span className="text-xs text-slate-600">{gap.monthsInLevel}/{gap.monthsRequired} luni</span>
          </li>
        )}
      </ul>
      {gap.ready && <p className="text-sm font-medium text-emerald-700">{ro.profile.ready}</p>}
    </div>
  );
}
