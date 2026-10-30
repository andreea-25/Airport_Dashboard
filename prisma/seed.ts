/* eslint-disable no-console */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { addDaysStr, dateOnly, localToUtc, mondayOf, shiftInterval } from "../src/lib/time";
import { createScenarioFromReal, applyChange } from "../src/lib/sim/scenario";

// Deterministic pseudo-random generator so every seed run produces the same data.
let rngState = 20261030;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const FIRST_M = ["Andrei", "Mihai", "Alexandru", "Ionuț", "Cristian", "Florin", "Bogdan", "Radu", "Vlad", "Marius", "Gabriel", "Adrian", "Daniel", "Sorin", "Cătălin", "Lucian", "Ovidiu", "Costin", "Dragoș", "Tudor"];
const FIRST_F = ["Ana", "Maria", "Elena", "Ioana", "Andreea", "Cristina", "Alina", "Raluca", "Diana", "Simona", "Larisa", "Bianca", "Oana", "Roxana", "Mădălina", "Corina", "Irina", "Daniela", "Gabriela", "Laura"];
const LAST = ["Popescu", "Ionescu", "Popa", "Dumitru", "Stan", "Stoica", "Gheorghe", "Matei", "Ciobanu", "Rusu", "Mihai", "Constantin", "Marin", "Dinu", "Barbu", "Nistor", "Florea", "Tudor", "Dobre", "Zamfir", "Preda", "Cojocaru", "Anghel", "Voicu", "Oprea", "Manole", "Lungu", "Sima", "Toma", "Ene", "Badea", "Neagu", "Croitoru", "Moldovan", "Enache", "Radu", "Bălan", "Petrescu", "Vasile", "Ungureanu"];

const LEVELS = [
  { name: "Agent I", rank: 1 },
  { name: "Agent II", rank: 2 },
  { name: "Senior", rank: 3 },
  { name: "Team Lead", rank: 4 },
  { name: "Supervizor", rank: 5 },
];

const SKILLS = [
  { code: "AVSEC", name: "Certificat securitate aviație (AVSEC)", type: "CERTIFICATION", hasExpiry: true },
  { code: "XRAY", name: "Operare echipament screening raze X", type: "SKILL", hasExpiry: false },
  { code: "ETD", name: "Operare echipament ETD", type: "SKILL", hasExpiry: false },
  { code: "AIRSIDE", name: "Permis de conducere pe platformă (airside)", type: "CERTIFICATION", hasExpiry: true },
  { code: "PUSHBACK", name: "Operare tractor pushback", type: "CERTIFICATION", hasExpiry: true },
  { code: "BELT", name: "Operare bandă bagaje", type: "SKILL", hasExpiry: false },
  { code: "GPU", name: "Operare GPU (ground power unit)", type: "SKILL", hasExpiry: false },
  { code: "DGR", name: "Mărfuri periculoase (DGR)", type: "CERTIFICATION", hasExpiry: true },
  { code: "DCS", name: "Sistem de check-in (DCS)", type: "SKILL", hasExpiry: false },
  { code: "PRM", name: "Asistență PRM", type: "CERTIFICATION", hasExpiry: true },
  { code: "DEICE", name: "Degivrare aeronave", type: "CERTIFICATION", hasExpiry: true },
  { code: "FIRSTAID", name: "Prim ajutor", type: "CERTIFICATION", hasExpiry: true },
  { code: "ENG", name: "Limba engleză", type: "SKILL", hasExpiry: false }, // 1 = A2, 2 = B1, 3 = B2/C1
  { code: "TEAMCOORD", name: "Coordonare echipă", type: "SKILL", hasExpiry: false },
] as const;

type DeptDef = {
  code: string;
  name: string;
  teams: number;
  teamSize: number;
  slots: ("M" | "A" | "N" | "D" | "W" | "OFF")[]; // rotation slots, one per team
  coreSkills: string[]; // skills every member should have
  positions: { name: string; skills: [string, number][] }[];
  // hourly staffing profile: [startHour, endHour, minStaff]
  staffing: [number, number, number][];
};

const DEPTS: DeptDef[] = [
  {
    code: "CHK", name: "Check-in și ticketing", teams: 3, teamSize: 4, slots: ["M", "A", "D"],
    coreSkills: ["DCS", "ENG"],
    positions: [
      { name: "Ghișeu check-in", skills: [["DCS", 1]] },
      { name: "Ghișeu bagaje speciale", skills: [["DCS", 2], ["DGR", 1]] },
    ],
    staffing: [[5, 9, 4], [9, 18, 2], [18, 22, 3]],
  },
  {
    code: "SEC", name: "Securitate", teams: 4, teamSize: 5, slots: ["M", "A", "N", "OFF"],
    coreSkills: ["AVSEC", "XRAY", "ENG"],
    positions: [
      { name: "Linie screening 1", skills: [["AVSEC", 1], ["XRAY", 2]] },
      { name: "Linie screening 2", skills: [["AVSEC", 1], ["XRAY", 1]] },
      { name: "Control ETD", skills: [["AVSEC", 1], ["ETD", 1]] },
    ],
    staffing: [[0, 5, 1], [5, 9, 4], [9, 18, 3], [18, 22, 4], [22, 24, 1]],
  },
  {
    code: "RMP", name: "Handling rampă", teams: 3, teamSize: 5, slots: ["M", "A", "D"],
    coreSkills: ["AIRSIDE"],
    positions: [
      { name: "Pushback", skills: [["AIRSIDE", 1], ["PUSHBACK", 1]] },
      { name: "Încărcare/descărcare", skills: [["AIRSIDE", 1]] },
      { name: "Operator GPU", skills: [["AIRSIDE", 1], ["GPU", 1]] },
    ],
    staffing: [[5, 9, 5], [9, 18, 3], [18, 22, 5]],
  },
  {
    code: "BAG", name: "Sortare bagaje", teams: 2, teamSize: 4, slots: ["M", "A"],
    coreSkills: ["BELT"],
    positions: [{ name: "Bandă sortare", skills: [["BELT", 1]] }],
    staffing: [[6, 9, 3], [9, 18, 2], [18, 22, 3]],
  },
  {
    code: "PRM", name: "Asistență PRM", teams: 2, teamSize: 3, slots: ["M", "A"],
    coreSkills: ["PRM", "FIRSTAID"],
    positions: [{ name: "Asistent PRM", skills: [["PRM", 1], ["FIRSTAID", 1]] }],
    staffing: [[6, 9, 2], [9, 18, 1], [18, 22, 2]],
  },
  {
    code: "GTE", name: "Informații pasageri și îmbarcare", teams: 2, teamSize: 4, slots: ["M", "A"],
    coreSkills: ["DCS", "ENG"],
    positions: [{ name: "Poartă îmbarcare", skills: [["DCS", 1], ["ENG", 2]] }, { name: "Birou informații", skills: [["ENG", 2]] }],
    staffing: [[6, 9, 3], [9, 18, 2], [18, 22, 3]],
  },
  {
    code: "OCC", name: "Dispecerat operațional (AOCC)", teams: 3, teamSize: 2, slots: ["M", "A", "N"],
    coreSkills: ["ENG"],
    positions: [{ name: "Dispecer", skills: [["ENG", 2]] }],
    staffing: [[0, 24, 1]],
  },
  {
    code: "MNT", name: "Mentenanță tehnică", teams: 3, teamSize: 2, slots: ["M", "A", "N"],
    coreSkills: ["AIRSIDE"],
    positions: [{ name: "Tehnician", skills: [["AIRSIDE", 1]] }, { name: "Degivrare", skills: [["AIRSIDE", 1], ["DEICE", 1]] }],
    staffing: [[0, 24, 1]],
  },
];

const TEMPLATES = {
  M: { name: "Dimineață", start: "06:00", end: "14:00" },
  A: { name: "După-amiază", start: "14:00", end: "22:00" },
  N: { name: "Noapte", start: "22:00", end: "06:00" },
  D: { name: "Zi", start: "09:00", end: "17:00" },
  W: { name: "Val dimineață", start: "05:00", end: "13:00" },
} as const;

// Advancement requirements per department (for levels 2..5). [skillCode, minProficiency]
function requirementsFor(dept: DeptDef, rank: number): { skills: [string, number][]; months: number } {
  const core = dept.coreSkills.filter((c) => c !== "ENG");
  const engLevel = rank >= 3 ? 2 : 1;
  const base: [string, number][] = core.map((c) => [c, Math.min(rank >= 3 ? 3 : rank >= 2 ? 2 : 1, 3)]);
  // certifications don't have proficiency beyond 1 in practice
  const fixed: [string, number][] = base.map(([c, p]) => {
    const sk = SKILLS.find((s) => s.code === c)!;
    return [c, sk.type === "CERTIFICATION" ? 1 : p];
  });
  const extra: [string, number][] = [];
  if (dept.code === "SEC" && rank >= 3) extra.push(["ETD", 2]);
  if (dept.code === "RMP" && rank >= 2) extra.push(["PUSHBACK", 1]);
  if (dept.code === "RMP" && rank >= 3) extra.push(["DGR", 1]);
  if (dept.code === "CHK" && rank >= 3) extra.push(["DGR", 1]);
  if (dept.code === "MNT" && rank >= 3) extra.push(["DEICE", 1]);
  if (rank >= 3) extra.push(["FIRSTAID", 1]);
  if (rank >= 4) extra.push(["TEAMCOORD", rank >= 5 ? 3 : 2]);
  const all = [...fixed, ...extra, ["ENG", rank >= 4 ? 3 : engLevel] as [string, number]];
  const dedup = new Map<string, number>();
  for (const [c, p] of all) dedup.set(c, Math.max(dedup.get(c) ?? 0, p));
  const months = [0, 0, 6, 12, 18, 24][rank];
  return { skills: [...dedup.entries()], months };
}

async function reset() {
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.scenarioSuggestion.deleteMany();
  await prisma.scenarioChange.deleteMany();
  await prisma.scenarioEmployeeOverride.deleteMany();
  await prisma.scenarioAssignment.deleteMany();
  await prisma.scenarioShift.deleteMany();
  await prisma.scenario.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.request.deleteMany();
  await prisma.shiftComment.deleteMany();
  await prisma.shiftAssignment.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.staffingRequirement.deleteMany();
  await prisma.positionSkill.deleteMany();
  await prisma.position.deleteMany();
  await prisma.levelRequirement.deleteMany();
  await prisma.employeeSkill.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.team.deleteMany();
  await prisma.department.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.level.deleteMany();
}

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error("Set SEED_DEMO_PASSWORD in .env (see .env.example)");
  const passwordHash = await bcrypt.hash(password, 10);

  console.log("Resetting data…");
  await reset();

  const now = new Date();
  const today = addDaysStr(mondayOf(now), 0);
  void today;

  // Levels and skills
  const levels: Record<number, string> = {};
  for (const l of LEVELS) levels[l.rank] = (await prisma.level.create({ data: l })).id;
  const skillId: Record<string, string> = {};
  for (const s of SKILLS) skillId[s.code] = (await prisma.skill.create({ data: { ...s } })).id;

  const templateId: Record<string, string> = {};
  for (const [k, t] of Object.entries(TEMPLATES)) {
    templateId[k] = (await prisma.shiftTemplate.create({ data: { name: `${t.name} ${t.start}–${t.end}`, startTime: t.start, endTime: t.end } })).id;
  }

  const usedNames = new Set<string>();
  function newName() {
    for (;;) {
      const female = rand() < 0.45;
      const first = pick(female ? FIRST_F : FIRST_M);
      const last = pick(LAST);
      const key = `${first} ${last}`;
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return { first, last };
      }
    }
  }
  const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

  type EmpInfo = { id: string; deptCode: string; teamIdx: number; idx: number; rank: number; skills: Map<string, number> };
  const employeesByDept: Record<string, EmpInfo[]> = {};
  const deptId: Record<string, string> = {};
  const teamIds: Record<string, string[]> = {};
  const positionIds: Record<string, { id: string; skills: [string, number][] }[]> = {};

  for (const d of DEPTS) {
    const dept = await prisma.department.create({ data: { name: d.name, code: d.code } });
    deptId[d.code] = dept.id;
    teamIds[d.code] = [];
    for (let t = 0; t < d.teams; t++) {
      const team = await prisma.team.create({ data: { departmentId: dept.id, name: `Echipa ${String.fromCharCode(65 + t)}` } });
      teamIds[d.code].push(team.id);
    }
    positionIds[d.code] = [];
    for (const p of d.positions) {
      const pos = await prisma.position.create({
        data: {
          departmentId: dept.id,
          name: p.name,
          skills: { create: p.skills.map(([c, minP]) => ({ skillId: skillId[c], minProficiency: minP })) },
        },
      });
      positionIds[d.code].push({ id: pos.id, skills: p.skills });
    }
    // level requirements
    for (let rank = 2; rank <= 5; rank++) {
      const req = requirementsFor(d, rank);
      for (const [c, p] of req.skills) {
        await prisma.levelRequirement.create({
          data: { departmentId: dept.id, levelId: levels[rank], skillId: skillId[c], minProficiency: p, minMonthsInPrevLevel: req.months },
        });
      }
    }
    // staffing (same profile every day; weekend evenings a bit lighter)
    for (let dow = 1; dow <= 7; dow++) {
      for (const [s, e, n] of d.staffing) {
        const min = dow >= 6 && s >= 9 && s < 18 ? Math.max(1, n - 1) : n;
        await prisma.staffingRequirement.create({ data: { departmentId: dept.id, dayOfWeek: dow, startHour: s, endHour: e, minStaff: min } });
      }
    }

    // employees
    employeesByDept[d.code] = [];
    for (let t = 0; t < d.teams; t++) {
      for (let i = 0; i < d.teamSize; i++) {
        // rank distribution: first member of team = lead (Senior / Team Lead), first team first member = Supervizor
        let rank: number;
        if (t === 0 && i === 0) rank = 5;
        else if (i === 0) rank = d.teamSize >= 4 ? 4 : 3;
        else if (i === 1) rank = 3;
        else rank = rand() < 0.5 ? 2 : 1;
        // Intentional gap for demo: SEC Echipa C has no Senior+ (lead missing)
        if (d.code === "SEC" && t === 2 && i <= 1) rank = 2;

        const { first, last } = newName();
        const yearsHired = rank === 1 ? 0.5 + rand() * 1.5 : rank === 2 ? 1.5 + rand() * 3 : 3 + rand() * 10;
        const hireDate = new Date(now.getTime() - yearsHired * 365 * 86400000);
        const monthsInLevel = rank === 1 ? yearsHired * 12 : 6 + Math.floor(rand() * 24);
        const levelSince = new Date(Math.max(hireDate.getTime(), now.getTime() - monthsInLevel * 30 * 86400000));
        const emp = await prisma.employee.create({
          data: {
            firstName: first,
            lastName: last,
            email: `${slug(first)}.${slug(last)}@aeroport.demo`,
            phone: `07${Math.floor(20000000 + rand() * 79999999)}`,
            departmentId: dept.id,
            teamId: teamIds[d.code][t],
            levelId: levels[rank],
            hireDate,
            levelSince,
          },
        });
        const info: EmpInfo = { id: emp.id, deptCode: d.code, teamIdx: t, idx: i, rank, skills: new Map() };
        employeesByDept[d.code].push(info);

        // skills coherent with level: everything required for the current level, plus some for the next
        const have = new Map<string, number>();
        const current = rank >= 2 ? requirementsFor(d, rank).skills : d.coreSkills.map((c) => [c, 1] as [string, number]);
        for (const [c, p] of current) have.set(c, p);
        for (const c of d.coreSkills) if (!have.has(c)) have.set(c, 1);
        if (!have.has("ENG")) have.set("ENG", 1);
        if (rank < 5) {
          for (const [c, p] of requirementsFor(d, rank + 1).skills) if (rand() < 0.45) have.set(c, Math.max(have.get(c) ?? 0, p));
        }
        // positions' skills for the dept (most members can work most positions)
        for (const p of d.positions) for (const [c, minP] of p.skills) if (rand() < 0.75 && !have.has(c)) have.set(c, minP);
        if (rank >= 3) have.set("FIRSTAID", 1);

        info.skills = have;
        for (const [c, p] of have) {
          const sk = SKILLS.find((s) => s.code === c)!;
          const obtainedAt = new Date(hireDate.getTime() + rand() * (now.getTime() - hireDate.getTime()));
          let expiresAt: Date | null = null;
          if (sk.hasExpiry) {
            const r = rand();
            // ~8% expire within the next 30 days (demo), ~4% already expired, rest 3–30 months away
            const days = r < 0.07 ? 3 + Math.floor(rand() * 27) : r < 0.09 ? -Math.floor(5 + rand() * 40) : 90 + Math.floor(rand() * 800);
            expiresAt = new Date(now.getTime() + days * 86400000);
          }
          await prisma.employeeSkill.create({
            data: { employeeId: emp.id, skillId: skillId[c], proficiency: Math.min(3, Math.max(1, p)), obtainedAt, expiresAt },
          });
        }
      }
    }
  }

  // ---------- Shifts: 2 weeks in the past, current week, next week and the one after ----------
  const firstMonday = addDaysStr(mondayOf(now), -14);
  const WEEKS = 5;
  console.log(`Generating shifts from ${firstMonday} for ${WEEKS} weeks…`);
  let shiftCount = 0;
  for (const d of DEPTS) {
    const emps = employeesByDept[d.code];
    for (let w = 0; w < WEEKS; w++) {
      for (let t = 0; t < d.teams; t++) {
        const slot = d.slots[(t + w) % d.slots.length];
        if (slot === "OFF") continue;
        const prevSlot = d.slots[(t + w - 1 + d.slots.length) % d.slots.length];
        const members = emps.filter((e) => e.teamIdx === t);
        for (let day = 0; day < 7; day++) {
          const dateStr = addDaysStr(firstMonday, w * 7 + day);
          const tpl = TEMPLATES[slot];
          const { startAt, endAt } = shiftInterval(dateStr, tpl.start, tpl.end);
          // Each member has 2 rest days per week, staggered inside the team
          const working = members.filter((m) => {
            const off1 = (m.idx * 2 + w) % 7;
            const off2 = (m.idx * 2 + 1 + w) % 7;
            if (day === off1 || day === off2) return false;
            // coming off a night week straight into mornings: Monday off to respect rest time
            if (day === 0 && prevSlot === "N" && slot === "M") return false;
            return true;
          });
          // Intentional coverage gaps for the demo: some days the security morning team is one person short
          const dropOne = d.code === "SEC" && slot === "M" && (day === 1 || day === 4) && working.length > 2;
          const finalMembers = dropOne ? working.slice(0, working.length - 1) : working;
          if (finalMembers.length === 0) continue;
          const lead = [...finalMembers].sort((a, b) => b.rank - a.rank)[0];
          const positions = positionIds[d.code];
          await prisma.shift.create({
            data: {
              departmentId: deptId[d.code],
              teamId: teamIds[d.code][t],
              date: dateOnly(dateStr),
              startAt,
              endAt,
              templateId: templateId[slot],
              assignments: {
                create: finalMembers.map((m, k) => ({
                  employeeId: m.id,
                  // prefer a position the employee is qualified for; fall back to round-robin
                  positionId: (
                    positions.find((p, pi) => pi === k % positions.length && p.skills.every(([c, mp]) => (m.skills.get(c) ?? 0) >= mp)) ??
                    positions.find((p) => p.skills.every(([c, mp]) => (m.skills.get(c) ?? 0) >= mp)) ??
                    positions[k % positions.length]
                  ).id,
                  isLead: m.id === lead.id && lead.rank >= 3,
                })),
              },
            },
          });
          shiftCount++;
        }
      }
    }
  }
  console.log(`Created ${shiftCount} shifts.`);

  // ---------- Users ----------
  const admin = await prisma.user.create({ data: { email: "admin@aeroport.demo", passwordHash, role: "ADMIN" } });
  const allEmps = await prisma.employee.findMany({ include: { level: true, department: true } });
  for (const e of allEmps) {
    await prisma.user.create({ data: { email: e.email, passwordHash, role: "EMPLOYEE", employeeId: e.id } });
  }

  // Demo accounts: stable, easy-to-type emails for a few employees from different departments
  // team index chosen relative to the rotation so the demo employee works day shifts in the current week
  const curWeek = 2;
  const teamOnSlot = (code: string, slot: string) => {
    const d = DEPTS.find((x) => x.code === code)!;
    for (let t = 0; t < d.teams; t++) if (d.slots[(t + curWeek) % d.slots.length] === slot) return t;
    return 0;
  };
  const demo: { code: string; rank: number; email: string; team: number }[] = [
    { code: "SEC", rank: 2, email: "angajat.securitate@aeroport.demo", team: teamOnSlot("SEC", "M") },
    { code: "RMP", rank: 2, email: "angajat.handling@aeroport.demo", team: teamOnSlot("RMP", "M") },
    { code: "CHK", rank: 1, email: "angajat.checkin@aeroport.demo", team: teamOnSlot("CHK", "A") },
    { code: "PRM", rank: 3, email: "angajat.prm@aeroport.demo", team: teamOnSlot("PRM", "M") },
  ];
  const demoUsers: Record<string, { userId: string; employeeId: string }> = {};
  for (const dm of demo) {
    const e = employeesByDept[dm.code].find((x) => x.rank === dm.rank && x.teamIdx === dm.team) ?? employeesByDept[dm.code].find((x) => x.rank === dm.rank)!;
    const user = await prisma.user.update({ where: { employeeId: e.id }, data: { email: dm.email } });
    demoUsers[dm.code] = { userId: user.id, employeeId: e.id };
  }

  // Make the security demo employee a good "what do I need for Senior" story: missing ETD and English B1
  const secDemo = demoUsers.SEC.employeeId;
  await prisma.employeeSkill.deleteMany({ where: { employeeId: secDemo, skillId: { in: [skillId.ETD] } } });
  await prisma.employeeSkill.upsert({
    where: { employeeId_skillId: { employeeId: secDemo, skillId: skillId.ENG } },
    update: { proficiency: 1 },
    create: { employeeId: secDemo, skillId: skillId.ENG, proficiency: 1, obtainedAt: new Date() },
  });
  await prisma.employeeSkill.update({
    where: { employeeId_skillId: { employeeId: secDemo, skillId: skillId.AVSEC } },
    data: { expiresAt: new Date(now.getTime() + 18 * 86400000) },
  });
  await prisma.employee.update({ where: { id: secDemo }, data: { levelSince: new Date(now.getTime() - 14 * 30 * 86400000) } });

  // ---------- Comments ----------
  const upcoming = await prisma.shiftAssignment.findMany({
    where: { employeeId: { in: Object.values(demoUsers).map((u) => u.employeeId) }, shift: { startAt: { gt: now } } },
    include: { shift: true },
    orderBy: { shift: { startAt: "asc" } },
  });
  const commentTexts = [
    "Am o programare medicală, pot pleca cu 30 min mai devreme?",
    "Scanerul de la linia 2 a dat erori ieri, de verificat la început de tură.",
    "Pot face schimb cu cineva din echipa B pentru ziua asta?",
  ];
  let ci = 0;
  for (const code of ["SEC", "RMP", "CHK"]) {
    const a = upcoming.find((x) => x.employeeId === demoUsers[code].employeeId);
    if (!a) continue;
    const c = await prisma.shiftComment.create({ data: { shiftId: a.shiftId, authorId: demoUsers[code].userId, body: commentTexts[ci++] } });
    if (code === "SEC") {
      await prisma.shiftComment.create({ data: { shiftId: a.shiftId, authorId: admin.id, body: "Da, anunță liderul de tură. Mulțumim!", parentId: c.id } });
    }
  }

  // ---------- Requests ----------
  await prisma.request.create({
    data: {
      employeeId: demoUsers.RMP.employeeId,
      type: "LEAVE",
      payload: { from: addDaysStr(mondayOf(now), 21), to: addDaysStr(mondayOf(now), 25), reason: "Concediu de odihnă" },
      status: "SUBMITTED",
    },
  });
  await prisma.request.create({
    data: {
      employeeId: demoUsers.CHK.employeeId,
      type: "SHIFT_SWAP",
      payload: { shiftDate: addDaysStr(mondayOf(now), 9), reason: "Examen la facultate", withColleague: "oricine din echipa B" },
      status: "IN_REVIEW",
    },
  });
  await prisma.request.create({
    data: {
      employeeId: demoUsers.PRM.employeeId,
      type: "CAREER_INFO",
      payload: { topic: "Curs coordonare echipă", details: "Când e următoarea sesiune?" },
      status: "APPROVED",
      adminResponse: "Următoarea sesiune începe pe 1 decembrie. Te-am înscris.",
      resolvedAt: new Date(),
      createdByAI: true,
    },
  });

  // ---------- Demo scenario: 12h shifts at ramp handling, next week ----------
  const nextMonday = addDaysStr(mondayOf(now), 7);
  const periodStart = localToUtc(nextMonday, "00:00");
  const periodEnd = localToUtc(addDaysStr(nextMonday, 7), "00:00");
  const scenario = await createScenarioFromReal({
    name: "Ture de 12h la handling",
    createdById: admin.id,
    periodStart,
    periodEnd,
    notes: "Handlingul rampă trece de la 3 ture de 8h la ture de 12h (06–18 și 18–06).",
  });
  await applyChange(scenario.id, { type: "CHANGE_SHIFT_HOURS", departmentId: deptId.RMP, fromStart: "06:00", startTime: "06:00", endTime: "18:00" });
  await applyChange(scenario.id, { type: "CHANGE_SHIFT_HOURS", departmentId: deptId.RMP, fromStart: "14:00", startTime: "18:00", endTime: "06:00" });

  console.log("Seed complete.");
  console.log("Demo accounts (password from SEED_DEMO_PASSWORD):");
  console.log("  admin@aeroport.demo");
  for (const d of demo) console.log(`  ${d.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
