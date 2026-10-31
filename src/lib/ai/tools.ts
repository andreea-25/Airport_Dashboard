import { prisma } from "../db";
import type { Session } from "../auth";
import { addDaysStr, fmt, localDateStr, localHour, localTimeStr, localToUtc, periodRange, SHIFT_PERIODS, type ShiftPeriod } from "../time";
import { getMyCareerGap, getMyProfile, getMyRequests, getMyShifts, getShiftDetail } from "../services/employee";
import { evaluate } from "../sim/evaluate";
import { loadScenarioData, previewChanges, skillGap } from "../sim/scenario";
import { findImprovements, type Candidate } from "../sim/optimize";
import { applyChangeToData, cloneData } from "../sim/changes";
import { changeSchema } from "../sim/schema";
import type { ToolDef } from "./ollama";
import { computeAll, loadTeamData, roDate } from "../team/readiness";
import { proposeReplacements } from "../team/replacement";

/**
 * Tool context comes from the server session — never from what the user types in the chat.
 * The model can only choose tool names and arguments; identity and scope are fixed here.
 */
export type ToolContext = { session: Session; scenarioId?: string | null; conversationId: string };
export type ToolResult = {
  result: unknown;
  pendingRequest?: { type: string; details: string; summary: string };
  /** stored with the tool call but not sent to the model (e.g. full change lists of candidates) */
  meta?: Record<string, unknown>;
};
type Exec = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description: string) => ({ type: "string", description });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const shiftOut = (s: { id: string; startAt: Date; endAt: Date; department: { name: string }; team: { name: string } | null }) => ({
  shift_id: s.id,
  zi: fmt(s.startAt, "EEEE dd.MM.yyyy"),
  ora: `${fmt(s.startAt, "HH:mm")}-${fmt(s.endAt, "HH:mm")}`,
  departament: s.department.name,
  echipa: s.team?.name ?? null,
});

// ============================================================================
// Employee mode
// ============================================================================

export const employeeTools: ToolDef[] = [
  fn(
    "get_my_shifts",
    "Turele utilizatorului curent (DOAR ale lui). Pentru perioade obișnuite folosește `period` — datele le calculează sistemul. Pentru o zi anume folosește from/to.",
    {
      period: { type: "string", enum: [...SHIFT_PERIODS], description: "azi, maine, weekend (weekendul acesta), saptamana_aceasta, saptamana_viitoare, urmatoarele_14_zile" },
      from: str("Opțional, doar pentru o zi/perioadă anume: data de început YYYY-MM-DD"),
      to: str("Opțional: data de sfârșit YYYY-MM-DD, inclusiv"),
    },
  ),
  fn("get_shift_colleagues", "Colegii dintr-o tură (doar ture în care e utilizatorul sau echipa lui).", { shift_id: str("ID-ul turei, din get_my_shifts") }, ["shift_id"]),
  fn("get_my_profile", "Profilul utilizatorului: departament, echipă, nivel, skill-uri și certificări cu expirare."),
  fn("get_my_career_gap", "Ce îi lipsește utilizatorului pentru nivelul următor (sau un nivel țintă).", {
    target_level: str("Opțional: Agent II, Senior, Team Lead sau Supervizor"),
  }),
  fn("get_my_requests", "Cererile trimise de utilizator și statusul lor."),
  fn(
    "create_request",
    "Pregătește o cerere către administrator. Cererea NU se trimite până când utilizatorul nu apasă Confirmă în interfață.",
    {
      type: { type: "string", enum: ["SHIFT_SWAP", "LEAVE", "CAREER_INFO", "OTHER"], description: "Tipul cererii" },
      details: str("Detaliile cererii, în română, așa cum le-a spus utilizatorul (date, motiv, curs etc.)"),
      summary: str("Rezumat scurt într-o propoziție"),
    },
    ["type", "details", "summary"],
  ),
];

const employeeExec: Record<string, Exec> = {
  async get_my_shifts(args, { session }) {
    const today = localDateStr(new Date());
    let from: string;
    let to: string;
    let label: string | null = null;
    if (typeof args.period === "string" && (SHIFT_PERIODS as readonly string[]).includes(args.period)) {
      ({ from, to, label } = periodRange(args.period as ShiftPeriod, today));
    } else {
      from = typeof args.from === "string" && DATE.test(args.from) ? args.from : today;
      to = typeof args.to === "string" && DATE.test(args.to) ? args.to : addDaysStr(from, 13);
    }
    const shifts = await getMyShifts(session, localToUtc(from, "00:00"), localToUtc(addDaysStr(to, 1), "00:00"));
    return {
      result: {
        perioada: label
          ? `${label}: ${fmt(localToUtc(from, "12:00"), "EEEE dd.MM")}${to !== from ? ` – ${fmt(localToUtc(to, "12:00"), "EEEE dd.MM")}` : ""}`
          : `${from} – ${to}`,
        ture: shifts.map((s) => ({ ...shiftOut(s), post: s.assignments.find((a) => a.employeeId === session.employeeId)?.position?.name ?? null })),
      },
    };
  },
  async get_shift_colleagues(args, { session }) {
    const d = await getShiftDetail(session, String(args.shift_id ?? ""));
    return {
      result: {
        tura: `${fmt(d.startAt, "EEEE dd.MM HH:mm")}-${fmt(d.endAt, "HH:mm")}, ${d.department}`,
        colegi: d.colleagues.map((c) => ({ nume: c.name, nivel: c.level, post: c.position, lider: c.isLead, eu: c.isMe })),
      },
    };
  },
  async get_my_profile(_a, { session }) {
    const p = await getMyProfile(session);
    return {
      result: {
        nume: `${p.firstName} ${p.lastName}`,
        departament: p.department.name,
        echipa: p.team?.name,
        nivel: p.level.name,
        in_nivel_din: fmt(p.levelSince, "dd.MM.yyyy"),
        skilluri: p.skills.map((s) => ({ nume: s.skill.name, tip: s.skill.type, nivel: s.proficiency, expira: s.expiresAt ? fmt(s.expiresAt, "dd.MM.yyyy") : null })),
        nota: "Limba engleză: 1=A2, 2=B1, 3=B2/C1",
      },
    };
  },
  async get_my_career_gap(args, { session }) {
    const g = await getMyCareerGap(session, typeof args.target_level === "string" ? args.target_level : null);
    return {
      result: {
        nivel_curent: g.currentLevel,
        nivel_tinta: g.targetLevel,
        pregatit: g.ready,
        lipsesc: g.items.filter((i) => !i.ok).map((i) => ({ skill: i.skillName, necesar: i.required, actual: i.current, expirat: i.expired })),
        indeplinite: g.items.filter((i) => i.ok).map((i) => i.skillName),
        vechime: { luni_in_nivel: g.monthsInLevel, luni_necesare: g.monthsRequired, ok: g.monthsOk },
      },
    };
  },
  async get_my_requests(_a, { session }) {
    const r = await getMyRequests(session);
    return { result: r.map((x) => ({ tip: x.type, status: x.status, creata: fmt(x.createdAt, "dd.MM.yyyy"), detalii: x.payload, raspuns_admin: x.adminResponse })) };
  },
  async create_request(args) {
    const type = ["SHIFT_SWAP", "LEAVE", "CAREER_INFO", "OTHER"].includes(String(args.type)) ? String(args.type) : "OTHER";
    const details = String(args.details ?? "").slice(0, 2000);
    const summary = String(args.summary ?? details).slice(0, 300);
    return {
      result: { status: "ASTEAPTA_CONFIRMARE", mesaj: "Cererea a fost pregătită. Spune-i utilizatorului să verifice rezumatul și să apese Confirmă. NU a fost trimisă încă." },
      pendingRequest: { type, details, summary },
    };
  },
};

// ============================================================================
// Admin simulation mode
// ============================================================================

const changeItems = {
  type: "array",
  description:
    "Listă de modificări. Tipuri: MOVE_EMPLOYEE_TEAM{employeeId,teamId}; SWAP_TEAMS{teamAId,teamBId}; ADD_ASSIGNMENT{shiftId,employeeId,positionId?}; REMOVE_ASSIGNMENT{assignmentId}; MOVE_ASSIGNMENT{assignmentId,toShiftId}; CHANGE_SHIFT_HOURS{departmentId,teamId?,fromStart?(HH:mm),shiftId?,startTime(HH:mm),endTime(HH:mm)}; SET_EMPLOYEE_LEVEL{employeeId,levelId}. Folosește exact ID-urile primite de la unelte.",
  items: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
};

export const adminTools: ToolDef[] = [
  fn(
    "find_improvements",
    "PRIMUL PAS pentru sugestii: optimizatorul încearcă sute de mutări mici pe scenariu și întoarce cele mai bune (C1, C2…), fiecare cu impactul calculat (scor, acoperire, încălcări). Poți exclude angajați sau limita la un departament.",
    {
      department_code: str("Opțional: doar un departament (SEC, RMP, CHK, BAG, PRM, GTE, OCC, MNT, ATC, MET, APR)"),
      exclude_employee_names: { type: "array", items: { type: "string" }, description: "Opțional: nume (sau părți de nume) de angajați care NU trebuie mutați" },
      limit: { type: "number", description: "Câte variante (implicit 8, maxim 10)" },
    },
  ),
  fn("get_scenario_summary", "Rezumatul scenariului curent: perioadă, departamente și echipe (cu ID-uri și orele turelor), indicatori, cele mai mari goluri de acoperire."),
  fn("evaluate_scenario", "Indicatorii detaliați ai scenariului curent: acoperire pe departament, încălcări de reguli, posturi fără skill, certificări care expiră."),
  fn("list_shifts", "Turele din scenariu pentru un departament (opțional o zi), cu ID-uri, oameni asignați și necesar.", {
    department_code: str("Codul departamentului (ex. SEC, RMP, CHK)"),
    date: str("Ziua YYYY-MM-DD (opțional)"),
  }, ["department_code"]),
  fn("list_employees", "Angajații unui departament cu ID, echipă, nivel.", { department_code: str("Codul departamentului") }, ["department_code"]),
  fn("get_employee_skill_gap", "Ce skill-uri îi lipsesc unui angajat pentru nivelul următor sau pentru mutarea în alt departament. Poți da direct numele angajatului.", {
    employee_name: str("Numele angajatului, ex. „Bogdan Popescu” (sau doar numele de familie)"),
    employee_id: str("Opțional: ID-ul angajatului, dacă îl ai din list_employees"),
    target_department_code: str("Opțional: codul departamentului țintă"),
  }),
  fn(
    "get_team_readiness",
    "Semaforul echipei: pe cine te poți baza în următoarele 30/60/90 de zile (verde/portocaliu/roșu, cu motive: demisii, final de contract, concedii, certificări care expiră) și echilibrul fiecărui departament (oameni disponibili față de necesar, competențe critice). Nu depinde de scenariu.",
    {
      department_code: str("Opțional: un departament (ex. SEC, ATC, MET, APR)"),
      horizon_days: { type: "number", description: "Orizontul: 30, 60 sau 90 de zile (implicit 30)" },
    },
  ),
  fn(
    "propose_replacements",
    "Propuneri de soluții când cineva nu mai e disponibil (demisie, final de contract, concediu lung, certificare expirată): mutare internă (eventual în lanț), prelungire + pregătirea unui coleg, candidat extern din baza de talente. Fiecare variantă are pași, avertismente, zile de pregătire și dacă e fezabilă.",
    {
      employee_name: str("Numele persoanei care pleacă / lipsește, ex. „Cătălin Stan”"),
      horizon_days: { type: "number", description: "Orizontul: 30, 60 sau 90 (implicit 30)" },
      extension_days: { type: "number", description: "Câte zile i se propune să mai rămână (implicit 30)" },
      what_if: { type: "string", enum: ["demisie", "concediu_lung", "detasare"], description: "Doar pentru o IPOTEZĂ spusă de admin („dacă demisionează X”, „X intră în concediu lung”); nu salvează nimic" },
      from_date: str("Opțional, pentru ipoteză: prima zi de absență YYYY-MM-DD (implicit peste 30 de zile la demisie, azi la concediu)"),
      to_date: str("Opțional, pentru concediu/detașare: ultima zi YYYY-MM-DD"),
    },
    ["employee_name"],
  ),
  fn("preview_change", "Rulează motorul de simulare pe o copie temporară și returnează impactul. Nu salvează nimic.", { changes: changeItems }, ["changes"]),
  fn("propose_changes", "Salvează o sugestie pe care adminul o poate aplica cu un click. Nu aplică nimic. Cel mai simplu: dă candidate_ids din find_improvements (ex. [\"C1\",\"C3\"]); poți combina mai multe într-o singură sugestie. Alternativ, dă changes explicit.", {
    candidate_ids: { type: "array", items: { type: "string" }, description: "ID-uri din ultimul find_improvements, ex. [\"C1\"]" },
    changes: changeItems,
    rationale: str("Justificare scurtă în română: ce rezolvă și de ce"),
  }, ["rationale"]),
];

async function deptByCode(code: unknown) {
  const d = await prisma.department.findFirst({ where: { code: String(code ?? "").toUpperCase() } });
  if (!d) throw new Error(`Departament necunoscut: ${code}. Coduri valide: CHK, SEC, RMP, BAG, PRM, GTE, OCC, MNT, ATC, MET, APR`);
  return d;
}

function requireScenario(ctx: ToolContext) {
  if (ctx.session.role !== "ADMIN") throw new Error("Acces interzis");
  if (!ctx.scenarioId) throw new Error("Nu există un scenariu activ");
  return ctx.scenarioId;
}

function parseChanges(raw: unknown) {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
  return arr.map((c: unknown, i: number) => {
    const p = changeSchema.safeParse(c);
    if (!p.success) throw new Error(`Modificarea #${i + 1} e invalidă: ${p.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return p.data;
  });
}

const impactOut = (impact: Awaited<ReturnType<typeof previewChanges>>["impact"]) => ({
  acoperire_medie: impact.summary.avgCoverage,
  intervale_sub_necesar: impact.summary.understaffedSlots,
  ore_suplimentare: impact.summary.totalOvertime,
  incalcari: impact.summary.violationCount,
  posturi_fara_skill: impact.summary.mismatchCount,
  pe_departament: impact.byDept.filter((d) => d.delta !== 0).map((d) => ({ departament: d.name, inainte: d.a, dupa: d.b })),
});

/** Candidates returned by the last find_improvements call in this conversation. */
async function lastCandidates(conversationId: string): Promise<Candidate[]> {
  const msg = await prisma.aiMessage.findFirst({
    where: { conversationId, role: "tool", toolCalls: { path: ["name"], equals: "find_improvements" } },
    orderBy: { createdAt: "desc" },
  });
  return ((msg?.toolCalls as { meta?: { candidates?: Candidate[] } } | null)?.meta?.candidates ?? []) as Candidate[];
}

function requireAdmin(ctx: ToolContext) {
  if (ctx.session.role !== "ADMIN") throw new Error("Acces interzis");
}
const horizonOf = (v: unknown) => ([30, 60, 90].includes(Number(v)) ? Number(v) : Number(v) > 60 ? 90 : Number(v) > 30 ? 60 : 30);
const COLOR_RO = { GREEN: "verde", ORANGE: "portocaliu", RED: "roșu" } as const;

const adminExec: Record<string, Exec> = {
  async get_team_readiness(args, ctx) {
    requireAdmin(ctx);
    const horizon = horizonOf(args.horizon_days);
    const data = await loadTeamData();
    const { readiness, balance } = computeAll(data, horizon);
    const code = args.department_code ? String(args.department_code).toUpperCase() : null;
    const depts = balance.filter((b) => !code || b.code === code);
    if (code && !depts.length) throw new Error(`Departament necunoscut: ${code}`);
    const ids = new Set(data.departments.filter((d) => depts.some((b) => b.id === d.id)).map((d) => d.id));
    const people = data.employees
      .filter((e) => ids.has(e.departmentId) && readiness.get(e.id)!.color !== "GREEN")
      .map((e) => {
        const r = readiness.get(e.id)!;
        return { nume: e.name, culoare: COLOR_RO[r.color], nivel: e.levelName, departament: data.departments.find((d) => d.id === e.departmentId)!.code, motive: r.reasons.map((x) => x.text) };
      })
      .sort((a, b) => (a.culoare === "roșu" ? -1 : 0) - (b.culoare === "roșu" ? -1 : 0));
    return {
      result: {
        orizont_zile: horizon,
        departamente: depts.map((b) => ({
          cod: b.code,
          nume: b.name,
          stare: COLOR_RO[b.status],
          verde: b.counts.GREEN,
          portocaliu: b.counts.ORANGE,
          rosu: b.counts.RED,
          necesar: b.required,
          marja: b.margin,
          competente_critice: b.critical.map((c) => `${c.name}: ${c.greenHolders} pe verde din ${c.needed} necesari`),
          echipe_fara_sef_de_tura: b.teams.filter((t) => !t.hasLead).map((t) => t.name),
        })),
        oameni_de_urmarit: people.slice(0, code ? 30 : 15),
        ...(people.length > (code ? 30 : 15) ? { nota: `Încă ${people.length - (code ? 30 : 15)} persoane; cere un departament anume pentru lista completă.` } : {}),
      },
    };
  },
  async propose_replacements(args, ctx) {
    requireAdmin(ctx);
    const name = norm(String(args.employee_name ?? "")).trim();
    if (!name) throw new Error("Dă employee_name");
    const data = await loadTeamData();
    const matches = data.employees.filter((e) => {
      const full = norm(e.name);
      return full === name || name.split(/\s+/).every((p) => full.split(" ").includes(p));
    });
    if (!matches.length) throw new Error(`Nu există niciun angajat activ cu numele „${args.employee_name}”`);
    if (matches.length > 1) return { result: { ambiguu: true, mesaj: "Mai mulți angajați au acest nume. Întreabă adminul la care se referă.", variante: matches.map((m) => m.name) } };
    const horizon = horizonOf(args.horizon_days);
    const ext = Math.max(0, Math.min(180, Number(args.extension_days) || 30));
    const WHAT: Record<string, string> = { demisie: "RESIGNATION", concediu_lung: "LEAVE", detasare: "SECONDMENT" };
    const type = WHAT[String(args.what_if ?? "")];
    const today = localDateStr(new Date());
    const from = DATE.test(String(args.from_date ?? "")) ? String(args.from_date) : addDaysStr(today, type === "RESIGNATION" ? 30 : 0);
    const whatIf = type ? { type, start: from, end: DATE.test(String(args.to_date ?? "")) ? String(args.to_date) : null } : null;
    const res = proposeReplacements(data, matches[0].id, { horizon, extensionDays: ext, whatIf })!;
    return {
      result: {
        angajat: `${res.employee.name} (${res.employee.level}, ${res.employee.department}${res.employee.team ? `, ${res.employee.team}` : ""})`,
        post: res.employee.position,
        culoare: COLOR_RO[res.readiness.color],
        motive: res.readiness.reasons.map((x) => x.text),
        lipseste_din: roDate(res.gapFrom),
        definitiv: res.permanent,
        marja_departament: res.departmentMargin,
        variante: res.options.slice(0, 5).map((o, i) => ({
          nr: i + 1,
          tip: { RENEW: "reînnoire", MOVE: "mutare internă", EXTEND: "prelungire + pregătire", CANDIDATE: "candidat extern" }[o.kind],
          titlu: o.title,
          fezabil: o.feasible,
          scor: o.score,
          pasi: o.steps,
          avertismente: o.warnings,
          zile_pregatire: o.trainingDays,
        })),
        ...(whatIf ? { ipoteza: `${args.what_if} din ${roDate(whatIf.start)} (nesalvată)` } : {}),
        link: `/admin/team/${res.employee.id}?h=${horizon}${whatIf ? `&what=${whatIf.type}&from=${whatIf.start}${whatIf.end ? `&to=${whatIf.end}` : ""}` : ""}`,
      },
    };
  },
  async find_improvements(args, ctx) {
    const id = requireScenario(ctx);
    const data = await loadScenarioData(id);
    const departmentId = args.department_code ? (await deptByCode(args.department_code)).id : null;
    const names = (Array.isArray(args.exclude_employee_names) ? args.exclude_employee_names : typeof args.exclude_employee_names === "string" ? [args.exclude_employee_names] : [])
      .map((n) => String(n).toLowerCase().trim())
      .filter(Boolean);
    const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const exclude = Object.values(data.employees).filter((e) => names.some((n) => norm(e.name).includes(norm(n)))).map((e) => e.id);
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 8));
    const r = findImprovements(data, { limit, departmentId, excludeEmployeeIds: exclude });
    return {
      result: {
        scor_actual: r.base.score.total,
        componente_scor: r.base.score,
        angajati_exclusi: exclude.map((e) => data.employees[e].name),
        variante_evaluate: r.evaluated,
        candidati: r.candidates.map((c) => ({
          id: c.id,
          tip: c.kind,
          descriere: c.description,
          scor: `${c.scoreBefore} → ${c.scoreAfter} (+${c.delta})`,
          acoperire: `${c.impact.coverage[0]}% → ${c.impact.coverage[1]}%`,
          intervale_sub_necesar: `${c.impact.understaffed[0]} → ${c.impact.understaffed[1]}`,
          incalcari: `${c.impact.violations[0]} → ${c.impact.violations[1]}`,
        })),
        nota: r.candidates.length ? "Folosește propose_changes cu candidate_ids. Candidații sunt independenți; dacă îi combini, impactul total e verificat din nou la salvare." : "Optimizatorul nu a găsit îmbunătățiri.",
      },
      meta: { candidates: r.candidates },
    };
  },
  async get_scenario_summary(_a, ctx) {
    const id = requireScenario(ctx);
    const sc = await prisma.scenario.findUniqueOrThrow({ where: { id } });
    const data = await loadScenarioData(id);
    const ev = evaluate(data);
    const teams = Object.values(data.teams).map((t) => {
      const times = new Set(data.shifts.filter((s) => s.teamId === t.id).map((s) => `${localTimeStr(s.startAt)}-${localTimeStr(s.endAt)}`));
      return { teamId: t.id, echipa: t.name, departament: data.departments[t.departmentId]?.code, ore_ture: [...times] };
    });
    // biggest gaps grouped by department + local hour
    const gaps: Record<string, { dept: string; hour: number; missing: number; slots: number }> = {};
    for (const c of ev.coverage) {
      if (c.assigned >= c.required) continue;
      const h = localHour(new Date(c.slotStart));
      const k = `${c.departmentId}|${h}`;
      const g = (gaps[k] ??= { dept: data.departments[c.departmentId].code, hour: h, missing: 0, slots: 0 });
      g.missing += c.required - c.assigned;
      g.slots++;
    }
    return {
      result: {
        scenariu: sc.name,
        perioada: `${fmt(sc.periodStart, "dd.MM.yyyy")} – ${fmt(new Date(sc.periodEnd.getTime() - 1), "dd.MM.yyyy")}`,
        departamente: Object.values(data.departments).map((d) => ({ departmentId: d.id, cod: d.code, nume: d.name })),
        echipe: teams,
        niveluri: Object.values(data.levels).map((l) => ({ levelId: l.id, nume: l.name, rang: l.rank })),
        indicatori: ev.summary,
        cele_mai_mari_goluri: Object.values(gaps).sort((a, b) => b.missing - a.missing).slice(0, 10).map((g) => ({ departament: g.dept, ora: `${String(g.hour).padStart(2, "0")}:00`, oameni_lipsa_total: g.missing, zile_afectate: g.slots })),
      },
    };
  },
  async evaluate_scenario(_a, ctx) {
    const id = requireScenario(ctx);
    const ev = evaluate(await loadScenarioData(id));
    const byType: Record<string, number> = {};
    for (const v of ev.violations) byType[v.type] = (byType[v.type] ?? 0) + 1;
    return {
      result: {
        indicatori: ev.summary,
        acoperire_pe_departament: ev.coverageByDept.map((d) => ({ departament: d.name, departmentId: d.departmentId, medie: d.avgPct, intervale_sub_necesar: d.understaffedSlots })),
        incalcari_pe_tip: byType,
        exemple_incalcari: ev.violations.slice(0, 12).map((v) => v.message),
        posturi_fara_skill: ev.skillMismatches.slice(0, 8).map((m) => `${m.name} (${m.employeeId}) pe ${m.positionName}: lipsă ${m.missingSkills.join(", ")}`),
        certificari_care_expira: ev.expiringCertifications.slice(0, 8).map((c) => `${c.name}: ${c.skillName} ${c.expired ? "EXPIRAT" : "expiră"} ${fmt(new Date(c.expiresAt), "dd.MM")}`),
      },
    };
  },
  async list_shifts(args, ctx) {
    const id = requireScenario(ctx);
    const dept = await deptByCode(args.department_code);
    const data = await loadScenarioData(id);
    const ev = evaluate(data);
    const day = typeof args.date === "string" && DATE.test(args.date) ? args.date : null;
    const shifts = data.shifts.filter((s) => s.departmentId === dept.id && (!day || localDateStr(s.startAt) === day)).slice(0, 40);
    return {
      result: shifts.map((s) => {
        const slots = ev.coverage.filter((c) => c.departmentId === dept.id && c.slotStart >= s.startAt.toISOString() && c.slotStart < s.endAt.toISOString());
        return {
          shiftId: s.id,
          zi: fmt(s.startAt, "EEE dd.MM"),
          ora: `${localTimeStr(s.startAt)}-${localTimeStr(s.endAt)}`,
          echipa: s.teamId ? data.teams[s.teamId]?.name : null,
          teamId: s.teamId,
          necesar_maxim: Math.max(0, ...slots.map((c) => c.required)),
          acoperire_minima: slots.length ? Math.min(...slots.map((c) => c.pct)) + "%" : null,
          oameni: s.assignments.map((a) => ({ assignmentId: a.id, employeeId: a.employeeId, nume: data.employees[a.employeeId]?.name, nivel: data.employees[a.employeeId]?.levelName })),
        };
      }),
    };
  },
  async list_employees(args, ctx) {
    const id = requireScenario(ctx);
    const dept = await deptByCode(args.department_code);
    const data = await loadScenarioData(id);
    return {
      result: Object.values(data.employees)
        .filter((e) => e.departmentId === dept.id)
        .map((e) => ({ employeeId: e.id, nume: e.name, echipa: e.teamId ? data.teams[e.teamId]?.name : null, teamId: e.teamId, nivel: e.levelName })),
    };
  },
  async get_employee_skill_gap(args, ctx) {
    const id = requireScenario(ctx);
    const target = args.target_department_code ? { targetDepartmentId: (await deptByCode(args.target_department_code)).id } : {};
    // accept an id or a name (models often put the name in employee_id)
    let employeeId = typeof args.employee_id === "string" ? args.employee_id : "";
    if (!employeeId || !(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) {
      const name = norm(String(args.employee_name ?? args.employee_id ?? "")).trim();
      if (!name) throw new Error("Dă employee_name (numele angajatului)");
      const all = await prisma.employee.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } });
      const matches = all.filter((e) => {
        const full = norm(`${e.firstName} ${e.lastName}`);
        return full === name || name.split(/\s+/).every((part) => full.split(" ").includes(part));
      });
      if (!matches.length) throw new Error(`Nu există niciun angajat activ cu numele „${args.employee_name ?? args.employee_id}”`);
      if (matches.length > 1) {
        return { result: { ambiguu: true, mesaj: "Mai mulți angajați au acest nume. Întreabă adminul la care se referă.", variante: matches.map((m) => `${m.firstName} ${m.lastName}`) } };
      }
      employeeId = matches[0].id;
    }
    const ov = await prisma.scenarioEmployeeOverride.findUnique({ where: { scenarioId_employeeId: { scenarioId: id, employeeId } } });
    const g = await skillGap(employeeId, target, ov ?? undefined);
    return { result: { angajat: g.employeeName, tinta: g.targetLevel ?? g.targetDepartment, pregatit: g.ready, lipsesc: g.items.filter((i) => !i.ok).map((i) => `${i.skillName} (${i.current}/${i.required}${i.expired ? ", expirat" : ""})`), vechime_ok: g.monthsOk } };
  },
  async preview_change(args, ctx) {
    const id = requireScenario(ctx);
    const changes = parseChanges(args.changes);
    const r = await previewChanges(id, changes);
    return { result: { modificari: r.messages, impact: impactOut(r.impact) } };
  },
  async propose_changes(args, ctx) {
    const id = requireScenario(ctx);
    const ids = (Array.isArray(args.candidate_ids) ? args.candidate_ids : typeof args.candidate_ids === "string" ? String(args.candidate_ids).split(/[,\s]+/) : []).map(String).filter(Boolean);
    let changes = args.changes ? parseChanges(args.changes) : [];
    const skipped: string[] = [];
    if (ids.length) {
      const cands = await lastCandidates(ctx.conversationId);
      // combine candidates one by one on a copy; skip any that conflicts with the ones already taken
      const work = cloneData(await loadScenarioData(id));
      for (const c of changes) applyChangeToData(work, c);
      for (const cid of ids) {
        const c = cands.find((x) => x.id.toUpperCase() === cid.toUpperCase());
        if (!c) throw new Error(`Candidatul ${cid} nu există. Rulează find_improvements și folosește ID-urile primite.`);
        const trial = cloneData(work);
        try {
          for (const ch of c.changes) applyChangeToData(trial, ch);
        } catch (e) {
          skipped.push(`${cid} (${(e as Error).message})`);
          continue;
        }
        for (const ch of c.changes) applyChangeToData(work, ch);
        changes = [...changes, ...c.changes];
      }
    }
    if (!changes.length) throw new Error("Lista de modificări e goală: dă candidate_ids sau changes");
    const r = await previewChanges(id, changes); // validates against the engine before saving
    const sug = await prisma.scenarioSuggestion.create({
      data: { scenarioId: id, source: "AI", changes: changes as object, rationale: String(args.rationale ?? "").slice(0, 2000), estimatedImpact: { messages: r.messages, ...r.impact } as object },
    });
    return { result: { salvat: true, suggestionId: sug.id, modificari: r.messages, impact: impactOut(r.impact), ...(skipped.length ? { candidati_omisi_conflict: skipped } : {}) } };
  },
};

export function toolsFor(mode: "EMPLOYEE" | "ADMIN_SIM") {
  return mode === "EMPLOYEE" ? { defs: employeeTools, exec: employeeExec } : { defs: adminTools, exec: adminExec };
}
