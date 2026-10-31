// Replacement proposals for a person you can't count on (resignation, contract end, long absence).
// Three families of solutions, all deterministic and explainable:
//   MOVE       — someone qualified moves into the gap; if that opens a gap in their own department, a second
//                person backfills them (a chain of at most two moves) or their department has spare people.
//   EXTEND     — the leaving person is asked to stay N more days (default 30) while a colleague is trained.
//   CANDIDATE  — someone from the external pool (students met at faculties / events) is hired and trained.
import type { Change as SimChange } from "@/lib/sim/types";
import { addDaysStr, localDateStr } from "@/lib/time";
import {
  PERMANENT_TYPES as PERMANENT,
  calendarFromWorkdays,
  computeAll,
  daysBetween,
  requiredHeadcount,
  rolePosition,
  roDate,
  workdays,
  type Readiness,
  type TeamData,
  type TeamEmployee,
} from "./readiness";

export type GapSkill = { code: string; name: string; have: number; need: number; days: number };
export type Option = {
  kind: "RENEW" | "MOVE" | "EXTEND" | "CANDIDATE";
  title: string;
  feasible: boolean;
  /** 0–100, higher is better */
  score: number;
  steps: string[];
  warnings: string[];
  /** working days of training needed before the person can take over */
  trainingDays: number;
  readyBy: string | null;
  people: { id: string; name: string; role: string; kind: "EMPLOYEE" | "CANDIDATE" }[];
  /** changes that reproduce the solution in a simulation scenario */
  changes: SimChange[];
};
export type ReplacementResult = {
  employee: { id: string; name: string; department: string; departmentCode: string; team: string | null; level: string; position: string | null };
  readiness: Readiness;
  /** the date from which the gap exists */
  gapFrom: string;
  gapTo: string | null;
  permanent: boolean;
  departmentMargin: number;
  options: Option[];
};

type Need = { skillId: string; min: number }[];
/** A renewal is a short refresher + exam, not the full course. */
const renewDays = (td: number) => Math.min(10, Math.max(2, Math.round(td * 0.3)));

function needOf(data: TeamData, emp: TeamEmployee): { position: string | null; need: Need; minRank: number } {
  const pos = rolePosition(data, emp);
  const need = (pos?.skills ?? []).map((s) => ({ skillId: s.skillId, min: s.minProficiency }));
  // a Senior or above usually also leads the shift: the replacement should be able to lead too
  return { position: pos?.name ?? null, need, minRank: emp.rank >= 3 ? 3 : 1 };
}

/** Missing skills (and expired / soon-expiring certificates) of a person against a need, with training days. */
export function gapFor(data: TeamData, skills: Map<string, { proficiency: number; expiresAt: string | null }>, need: Need, validUntil: string): GapSkill[] {
  const out: GapSkill[] = [];
  for (const n of need) {
    const sk = data.skillById.get(n.skillId)!;
    const have = skills.get(n.skillId);
    const p = have?.proficiency ?? 0;
    if (p < n.min) {
      const levels = sk.type === "CERTIFICATION" ? 1 : n.min - p;
      out.push({ code: sk.code, name: sk.name, have: p, need: n.min, days: sk.trainingDays * levels });
    } else if (sk.hasExpiry && have?.expiresAt && have.expiresAt < validUntil) {
      out.push({ code: sk.code, name: `${sk.name} (reînnoire)`, have: p, need: n.min, days: renewDays(sk.trainingDays) });
    }
  }
  return out;
}
export const gapDays = (g: GapSkill[]) => g.reduce((a, s) => a + s.days, 0);
export const gapText = (g: GapSkill[]) => g.map((s) => `${s.name} (${s.days} zile)`).join(", ");

export type WhatIf = { type: string; start: string; end?: string | null };

export function proposeReplacements(
  baseData: TeamData,
  employeeId: string,
  opts: { horizon?: number; extensionDays?: number; today?: string; whatIf?: WhatIf | null } = {},
): ReplacementResult | null {
  const horizon = opts.horizon ?? 30;
  const extension = opts.extensionDays ?? 30;
  const today = opts.today ?? localDateStr(new Date());
  // "what if X resigns / goes on long leave": a hypothetical event, never saved
  const w = opts.whatIf;
  const data: TeamData = w
    ? {
        ...baseData,
        absences: [
          ...baseData.absences,
          { id: "what-if", employeeId, type: w.type, start: w.start < today ? today : w.start, end: PERMANENT.has(w.type) ? null : w.end ?? addDaysStr(w.start, 59), note: "Ipoteză (nesalvată)", source: "EVENT" as const },
        ],
      }
    : baseData;
  const { readiness, balance } = computeAll(data, horizon, today);
  const emp = data.employees.find((e) => e.id === employeeId);
  if (!emp) return null;
  const r = readiness.get(emp.id)!;
  const dept = data.departments.find((d) => d.id === emp.departmentId)!;
  const deptBal = balance.find((b) => b.id === dept.id)!;
  const { position, need, minRank } = needOf(data, emp);

  const permanent = !!r.leavesOn && daysBetween(today, r.leavesOn) <= horizon + 30;
  const certReasons = r.reasons.filter((x) => x.kind === "CERT");
  const certOnly = !permanent && !r.awayFrom && certReasons.length > 0;
  const certFrom = certReasons.map((x) => x.date!).sort()[0];
  const gapFrom = permanent ? r.leavesOn! : r.awayFrom ?? (certFrom && certFrom > today ? certFrom : today);
  const gapTo = permanent ? null : r.awayTo;
  const daysUntilGap = Math.max(0, daysBetween(today, gapFrom));
  const validUntil = addDaysStr(gapFrom, horizon);
  const color = (id: string) => readiness.get(id)?.color ?? "GREEN";
  const empName = (e: TeamEmployee) => `${e.name} (${e.levelName}, ${data.departments.find((d) => d.id === e.departmentId)?.name})`;
  // margin of a department if one more person left it ("can it give someone away?")
  const spare = (deptId: string) => balance.find((b) => b.id === deptId)!.margin;
  // the gap's department is already counted without X only if X is red; otherwise X still counts
  const margin = deptBal.margin - (color(emp.id) === "RED" ? 0 : 1);
  const options: Option[] = [];
  const absence: SimChange[] =
    daysUntilGap < 30 && !certOnly
      ? [{ type: "ADD_ABSENCE", employeeId: emp.id, date: gapFrom, days: Math.min(31, 35 - daysUntilGap, gapTo ? daysBetween(gapFrom, gapTo) + 1 : 31), reason: permanent ? "Plecare" : "Indisponibil" }]
      : [];

  const others = data.employees.filter((e) => e.id !== emp.id && color(e.id) === "GREEN");
  const people_ = (n: number) => `${n} ${n === 1 ? "om" : "oameni"}`;

  // ------------------------------------------------------------------ RENEW (certificate problems only)
  if (certReasons.length) {
    const certs = [...emp.skills.entries()]
      .map(([id, s]) => ({ sk: data.skillById.get(id)!, s }))
      .filter(({ sk, s }) => sk.hasExpiry && s.expiresAt && s.expiresAt <= addDaysStr(today, horizon));
    const days = certs.reduce((a, c) => a + renewDays(c.sk.trainingDays), 0);
    const expired = certs.some((c) => c.s.expiresAt! < today);
    options.push({
      kind: "RENEW",
      title: `Reînnoire certificare: ${certs.map((c) => c.sk.name).join(", ")}`,
      feasible: true,
      score: expired ? 85 : 95,
      steps: [
        ...certs.map((c) => `${c.sk.name}: ${c.s.expiresAt! < today ? "expirat pe" : "expiră pe"} ${roDate(c.s.expiresAt!)} — curs de reînnoire ~${renewDays(c.sk.trainingDays)} zile.`),
        expired
          ? `Până la reînnoire, ${emp.name} nu poate lucra pe posturile care cer certificarea; acoperă cu un coleg din lista de mai jos.`
          : `Programează cursul înainte de expirare; ${emp.name} rămâne disponibil.`,
      ],
      warnings: [],
      trainingDays: days,
      readyBy: addDaysStr(today, calendarFromWorkdays(days)),
      people: [{ id: emp.id, name: emp.name, role: "reînnoiește certificarea", kind: "EMPLOYEE" }],
      changes: [],
    });
  }

  // ------------------------------------------------------------------ MOVE (qualified now)
  const qualified = others
    .map((y) => ({ y, gap: gapFor(data, y.skills, need, validUntil) }))
    .filter(({ y, gap }) => y.rank >= minRank && gapDays(gap) <= 5);
  for (const { y, gap } of qualified) {
    const sameDept = y.departmentId === emp.departmentId;
    if (sameDept && y.teamId === emp.teamId) continue;
    const steps: string[] = [];
    const warnings: string[] = [];
    const changes: SimChange[] = [...absence];
    const people: Option["people"] = [{ id: y.id, name: y.name, role: `preia postul de ${position ?? "în echipă"}`, kind: "EMPLOYEE" }];
    let score = 70;
    if (emp.teamId) changes.push({ type: "MOVE_EMPLOYEE_TEAM", employeeId: y.id, teamId: emp.teamId });
    if (sameDept) {
      // inside the department: only fixes the team, not the headcount
      steps.push(`${empName(y)} trece din ${y.teamName ?? "fără echipă"} în ${emp.teamName ?? "echipa lui " + emp.name} din ${roDate(gapFrom)}.`);
      if (margin < 0 && !certOnly) {
        warnings.push(`Departamentul rămâne cu ${people_(-margin)} sub necesar — combină cu un candidat extern.`);
        score -= 25;
      } else score += 10;
      const yTeam = deptBal.teams.find((t) => t.id === y.teamId);
      if (yTeam && yTeam.counts.GREEN <= 2) {
        warnings.push(`${y.teamName} rămâne cu ${people_(yTeam.counts.GREEN - 1)} pe verde.`);
        score -= 10;
      }
    } else {
      const ySpare = spare(y.departmentId);
      steps.push(`${empName(y)} se mută în ${dept.name}${emp.teamName ? `, ${emp.teamName}` : ""} din ${roDate(gapFrom)}.`);
      if (ySpare >= 1) {
        steps.push(`${data.departments.find((d) => d.id === y.departmentId)?.name} are ${people_(ySpare)} peste necesar — nu trebuie înlocuit.`);
        score += 5;
      } else {
        // second link of the chain: who can take Y's place?
        const yNeed = needOf(data, y);
        const z = others
          .filter((z) => z.id !== y.id && z.departmentId !== y.departmentId && z.departmentId !== emp.departmentId && spare(z.departmentId) >= 1 && z.rank >= yNeed.minRank)
          .map((z) => ({ z, gap: gapFor(data, z.skills, yNeed.need, validUntil) }))
          .sort((a, b) => gapDays(a.gap) - gapDays(b.gap))[0];
        if (z && gapDays(z.gap) <= Math.max(5, workdays(daysUntilGap))) {
          steps.push(
            `${empName(z.z)} îl înlocuiește pe ${y.name} (${yNeed.position ?? "post"})${z.gap.length ? ` după pregătire: ${gapText(z.gap)}` : ""}; departamentul lui are oameni peste necesar.`,
          );
          people.push({ id: z.z.id, name: z.z.name, role: `îl înlocuiește pe ${y.name}`, kind: "EMPLOYEE" });
          if (y.teamId) changes.push({ type: "MOVE_EMPLOYEE_TEAM", employeeId: z.z.id, teamId: y.teamId });
          score -= 10 + Math.min(15, gapDays(z.gap));
        } else {
          warnings.push(`${data.departments.find((d) => d.id === y.departmentId)?.name} rămâne fără rezervă; nu am găsit pe cineva care să-l înlocuiască pe ${y.name}.`);
          score -= 30;
        }
      }
    }
    if (gap.length) {
      steps.push(`Pregătire scurtă înainte: ${gapText(gap)}.`);
      score -= gapDays(gap);
    }
    if (minRank >= 3 && y.rank >= 3) steps.push(`Poate conduce tura (${y.levelName}).`);
    options.push({
      kind: "MOVE",
      title: certOnly ? `Acoperire temporară: ${y.name}` : sameDept ? `Redistribuire în departament: ${y.name}` : `Mutare internă: ${y.name}${people.length > 1 ? ` + ${people[1].name}` : ""}`,
      feasible: !warnings.some((w) => w.includes("nu am găsit")),
      score: Math.max(5, Math.min(100, score)),
      steps,
      warnings,
      trainingDays: gapDays(gap),
      readyBy: addDaysStr(today, calendarFromWorkdays(gapDays(gap))),
      people,
      changes,
    });
  }

  // ------------------------------------------------------------------ EXTEND (+ train a colleague)
  const cost = (t: TeamEmployee, g: GapSkill[]) => gapDays(g) + 4 * Math.abs(t.rank - emp.rank) + (t.departmentId === emp.departmentId ? 0 : 2);
  const trainees = certOnly
    ? []
    : others
        .filter((t) => t.rank >= Math.min(minRank, 2) && (t.departmentId === emp.departmentId || spare(t.departmentId) >= 1))
        .map((t) => ({ t, gap: gapFor(data, t.skills, need, validUntil) }))
        .filter(({ gap }) => gapDays(gap) > 5)
        .sort((a, b) => cost(a.t, a.gap) - cost(b.t, b.gap))
        .slice(0, 3);
  // training that takes many months is not a solution for this gap: say so once instead of listing people
  const tooLong = trainees.filter(({ gap }) => gapDays(gap) > 120);
  if (tooLong.length && tooLong.length === trainees.length) {
    const g = tooLong[0].gap;
    options.push({
      kind: "EXTEND",
      title: "Pregătire internă: nefezabilă pe termen scurt",
      feasible: false,
      score: 5,
      steps: [`Nimeni din afara departamentului nu poate fi pregătit în timp util: ${gapText(g)}.`, "Soluția realistă: redistribuire în departament + recrutare cu pregătire lungă (candidat cu profil de specialitate)."],
      warnings: [],
      trainingDays: gapDays(g),
      readyBy: null,
      people: [],
      changes: [],
    });
  }
  for (const { t, gap } of trainees.filter(({ gap }) => gapDays(gap) <= 120)) {
    const days = gapDays(gap);
    const ext = permanent ? extension : 0;
    const window = workdays(daysUntilGap + ext);
    const neededExt = Math.max(0, calendarFromWorkdays(days) - daysUntilGap);
    const feasible = days <= window;
    const sameDept = t.departmentId === emp.departmentId;
    const steps: string[] = [];
    const warnings: string[] = [];
    if (permanent) steps.push(`Propune-i lui ${emp.name} să mai rămână ${ext} de zile (până pe ${roDate(addDaysStr(gapFrom, ext - 1))}) — necesită acordul lui.`);
    steps.push(`${empName(t)} începe pregătirea acum: ${gapText(gap)} — ${days} zile lucrătoare, cu ${emp.name} ca mentor.`);
    if (!sameDept) steps.push(`Apoi trece în ${dept.name}${emp.teamName ? `, ${emp.teamName}` : ""}; departamentul lui are oameni peste necesar.`);
    else if (margin < 0) warnings.push("Colegul e din același departament: acoperă competențele, dar numărul de oameni rămâne sub necesar.");
    if (!feasible)
      warnings.push(
        permanent
          ? `Nu ajunge timpul: ar fi nevoie de ~${neededExt} zile de prelungire, nu ${ext}.`
          : `Pregătirea durează mai mult decât timpul rămas până la ${roDate(gapFrom)} (${workdays(daysUntilGap)} zile lucrătoare).`,
      );
    const changes: SimChange[] = [...absence];
    if (!sameDept && emp.teamId) changes.push({ type: "MOVE_EMPLOYEE_TEAM", employeeId: t.id, teamId: emp.teamId });
    options.push({
      kind: "EXTEND",
      title: permanent ? `Prelungire ${ext} zile + pregătire: ${t.name}` : `Pregătire înainte de plecare: ${t.name}`,
      feasible,
      score: Math.max(5, Math.min(95, (feasible ? 65 : 25) - Math.round(days / 3) + (sameDept ? 5 : 0) - (sameDept && margin < 0 ? 15 : 0))),
      steps,
      warnings,
      trainingDays: days,
      readyBy: addDaysStr(today, calendarFromWorkdays(days)),
      people: [{ id: t.id, name: t.name, role: "este pregătit pentru post", kind: "EMPLOYEE" }],
      changes,
    });
  }

  // ------------------------------------------------------------------ CANDIDATE (external pool)
  const deadline = addDaysStr(gapFrom, permanent ? extension : 0);
  const pool = (certOnly ? [] : data.candidates)
    .filter((c) => c.consentAt && !c.hiredEmployeeId && !["HIRED", "REJECTED"].includes(c.status))
    .map((c) => {
      const skills = new Map(c.skills.map((s) => [s.skillId, { proficiency: s.proficiency, expiresAt: s.expiresAt ? s.expiresAt.toISOString().slice(0, 10) : null }]));
      const gap = gapFor(data, skills, need, validUntil);
      const start = c.availableFrom && c.availableFrom.toISOString().slice(0, 10) > today ? c.availableFrom.toISOString().slice(0, 10) : today;
      const readyBy = addDaysStr(start, calendarFromWorkdays(gapDays(gap)));
      const interested = c.interests.includes(dept.code);
      return { c, gap, start, readyBy, interested };
    })
    .filter((x) => x.interested || x.gap.length <= 1)
    .sort((a, b) => a.readyBy.localeCompare(b.readyBy) || Number(b.interested) - Number(a.interested))
    .slice(0, 3);
  const STATUS: Record<string, string> = { NEW: "nou", CONTACTED: "contactat", INTERVIEW: "la interviu", OFFER: "ofertă trimisă" };
  for (const x of pool) {
    const feasible = x.readyBy <= deadline;
    const days = gapDays(x.gap);
    const steps = [
      `${x.c.firstName} ${x.c.lastName} — ${x.c.specialization}, ${x.c.university} (${x.c.studyYear}); cunoscut la „${x.c.event}”, status: ${STATUS[x.c.status] ?? x.c.status}.`,
      `Disponibil din ${roDate(x.start)}; ${days ? `pregătire: ${gapText(x.gap)}` : "are deja competențele cerute"} → gata pe ${roDate(x.readyBy)}.`,
    ];
    const warnings: string[] = [];
    if (!feasible) warnings.push(`Ar fi gata după ${roDate(deadline)}${permanent ? " (inclusiv prelungirea)" : ""} — combină cu o mutare temporară.`);
    if (!x.interested) warnings.push(`Nu și-a exprimat interesul pentru ${dept.name}.`);
    if (minRank >= 3) warnings.push("Fără experiență de șef de tură: postul de lead trebuie preluat de un Senior din echipă.");
    if (permanent && x.readyBy > gapFrom && feasible) steps.push(`Necesită prelungirea cu ${emp.name} (sau o mutare temporară) până pe ${roDate(x.readyBy)}.`);
    options.push({
      kind: "CANDIDATE",
      title: `Candidat extern: ${x.c.firstName} ${x.c.lastName}`,
      feasible,
      score: Math.max(5, Math.min(90, (feasible ? 60 : 20) - Math.round(days / 4) + (x.interested ? 5 : 0) + (x.c.status === "OFFER" ? 10 : x.c.status === "INTERVIEW" ? 5 : 0) - (minRank >= 3 ? 10 : 0) + (margin < 0 ? 10 : 0))),
      steps,
      warnings,
      trainingDays: days,
      readyBy: x.readyBy,
      people: [{ id: x.c.id, name: `${x.c.firstName} ${x.c.lastName}`, role: "candidat extern", kind: "CANDIDATE" }],
      changes: [],
    });
  }

  // best per family first, then the rest; keep the list readable
  options.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.score - a.score);
  const kept: Option[] = [];
  const perKind: Record<string, number> = {};
  for (const o of options) {
    if ((perKind[o.kind] ?? 0) >= 3) continue;
    perKind[o.kind] = (perKind[o.kind] ?? 0) + 1;
    kept.push(o);
  }
  return {
    employee: { id: emp.id, name: emp.name, department: dept.name, departmentCode: dept.code, team: emp.teamName, level: emp.levelName, position },
    readiness: r,
    gapFrom,
    gapTo,
    permanent,
    departmentMargin: margin,
    options: kept.slice(0, 8),
  };
}

export { requiredHeadcount };

/** How quickly a candidate could work in each department (best position), given the department balance. */
export function candidateMatches(data: TeamData, candidateId: string, horizon = 30) {
  const c = data.candidates.find((x) => x.id === candidateId);
  if (!c) return [];
  const { balance } = computeAll(data, horizon);
  const skills = new Map(c.skills.map((s) => [s.skillId, { proficiency: s.proficiency, expiresAt: s.expiresAt ? s.expiresAt.toISOString().slice(0, 10) : null }]));
  const validUntil = addDaysStr(localDateStr(new Date()), horizon);
  return data.departments
    .map((d) => {
      const best = d.positions
        .map((p) => ({ p, gap: gapFor(data, skills, p.skills.map((s) => ({ skillId: s.skillId, min: s.minProficiency })), validUntil) }))
        .sort((a, b) => gapDays(a.gap) - gapDays(b.gap))[0];
      const b = balance.find((x) => x.id === d.id)!;
      return {
        departmentId: d.id,
        code: d.code,
        name: d.name,
        position: best?.p.name ?? null,
        trainingDays: best ? gapDays(best.gap) : 0,
        missing: best ? gapText(best.gap) : "",
        interested: c.interests.includes(d.code),
        margin: b.margin,
        status: b.status,
      };
    })
    .sort((a, b) => Number(b.interested) - Number(a.interested) || a.margin - b.margin || a.trainingDays - b.trainingDays);
}
