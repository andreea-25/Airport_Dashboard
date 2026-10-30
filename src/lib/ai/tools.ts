import { prisma } from "../db";
import type { Session } from "../auth";
import { addDaysStr, fmt, localDateStr, localHour, localTimeStr, localToUtc } from "../time";
import { getMyCareerGap, getMyProfile, getMyRequests, getMyShifts, getShiftDetail } from "../services/employee";
import { evaluate } from "../sim/evaluate";
import { loadScenarioData, previewChanges, skillGap } from "../sim/scenario";
import { changeSchema } from "../sim/schema";
import type { ToolDef } from "./ollama";

/**
 * Tool context comes from the server session — never from what the user types in the chat.
 * The model can only choose tool names and arguments; identity and scope are fixed here.
 */
export type ToolContext = { session: Session; scenarioId?: string | null; conversationId: string };
export type ToolResult = { result: unknown; pendingRequest?: { type: string; details: string; summary: string } };
type Exec = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description: string) => ({ type: "string", description });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
  fn("get_my_shifts", "Turele utilizatorului curent într-un interval. Implicit: următoarele 14 zile.", {
    from: str("Data de început YYYY-MM-DD (opțional)"),
    to: str("Data de sfârșit YYYY-MM-DD, inclusiv (opțional)"),
  }),
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
    const from = typeof args.from === "string" && DATE.test(args.from) ? args.from : today;
    const to = typeof args.to === "string" && DATE.test(args.to) ? args.to : addDaysStr(from, 13);
    const shifts = await getMyShifts(session, localToUtc(from, "00:00"), localToUtc(addDaysStr(to, 1), "00:00"));
    return { result: { interval: `${from} – ${to}`, ture: shifts.map((s) => ({ ...shiftOut(s), post: s.assignments.find((a) => a.employeeId === session.employeeId)?.position?.name ?? null })) } };
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
  fn("get_scenario_summary", "Rezumatul scenariului curent: perioadă, departamente și echipe (cu ID-uri și orele turelor), indicatori, cele mai mari goluri de acoperire."),
  fn("evaluate_scenario", "Indicatorii detaliați ai scenariului curent: acoperire pe departament, încălcări de reguli, posturi fără skill, certificări care expiră."),
  fn("list_shifts", "Turele din scenariu pentru un departament (opțional o zi), cu ID-uri, oameni asignați și necesar.", {
    department_code: str("Codul departamentului (ex. SEC, RMP, CHK)"),
    date: str("Ziua YYYY-MM-DD (opțional)"),
  }, ["department_code"]),
  fn("list_employees", "Angajații unui departament cu ID, echipă, nivel.", { department_code: str("Codul departamentului") }, ["department_code"]),
  fn("get_employee_skill_gap", "Ce skill-uri îi lipsesc unui angajat pentru nivelul următor sau pentru mutarea în alt departament.", {
    employee_id: str("ID angajat"),
    target_department_code: str("Opțional: codul departamentului țintă"),
  }, ["employee_id"]),
  fn("preview_change", "Rulează motorul de simulare pe o copie temporară și returnează impactul. Nu salvează nimic.", { changes: changeItems }, ["changes"]),
  fn("propose_changes", "Salvează o sugestie (listă de modificări + justificare) pe care adminul o poate aplica cu un click. Nu aplică nimic.", {
    changes: changeItems,
    rationale: str("Justificare scurtă în română: ce rezolvă și de ce"),
  }, ["changes", "rationale"]),
];

async function deptByCode(code: unknown) {
  const d = await prisma.department.findFirst({ where: { code: String(code ?? "").toUpperCase() } });
  if (!d) throw new Error(`Departament necunoscut: ${code}. Coduri valide: CHK, SEC, RMP, BAG, PRM, GTE, OCC, MNT`);
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

const adminExec: Record<string, Exec> = {
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
    const ov = await prisma.scenarioEmployeeOverride.findUnique({ where: { scenarioId_employeeId: { scenarioId: id, employeeId: String(args.employee_id) } } });
    const g = await skillGap(String(args.employee_id), target, ov ?? undefined);
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
    const changes = parseChanges(args.changes);
    if (!changes.length) throw new Error("Lista de modificări e goală");
    const r = await previewChanges(id, changes); // validates against the engine before saving
    const sug = await prisma.scenarioSuggestion.create({
      data: { scenarioId: id, source: "AI", changes: changes as object, rationale: String(args.rationale ?? "").slice(0, 2000), estimatedImpact: { messages: r.messages, ...r.impact } as object },
    });
    return { result: { salvat: true, suggestionId: sug.id, modificari: r.messages, impact: impactOut(r.impact) } };
  },
};

export function toolsFor(mode: "EMPLOYEE" | "ADMIN_SIM") {
  return mode === "EMPLOYEE" ? { defs: employeeTools, exec: employeeExec } : { defs: adminTools, exec: adminExec };
}
