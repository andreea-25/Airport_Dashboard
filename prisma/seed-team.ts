/* eslint-disable no-console */
// Demo data for the "Echipa" page: contract end dates, planned unavailability, a couple of manual
// semafor overrides and a pool of external candidates (students met at faculties / events).
import { prisma } from "../src/lib/db";
import { addDaysStr, dateOnly, localDateStr } from "../src/lib/time";

type EmpInfo = { id: string; deptCode: string; teamIdx: number; idx: number; rank: number; skills: Map<string, number> };

export async function seedTeam(opts: {
  now: Date;
  admin: string;
  employeesByDept: Record<string, EmpInfo[]>;
  skillId: Record<string, string>;
  rand: () => number;
}) {
  const { now, admin, employeesByDept: E, skillId, rand } = opts;
  const today = localDateStr(now);
  const day = (n: number) => dateOnly(addDaysStr(today, n));
  const used = new Set<string>();
  /** First not-yet-used employee of a department matching the filter. */
  const take = (code: string, f: (e: EmpInfo) => boolean = () => true) => {
    const e = E[code]?.find((x) => !used.has(x.id) && f(x)) ?? E[code]?.find((x) => !used.has(x.id));
    if (!e) throw new Error(`seed-team: no employee left in ${code}`);
    used.add(e.id);
    return e;
  };
  const event = (e: EmpInfo, type: string, start: number, end: number | null, note: string, announced = -3) =>
    prisma.availabilityEvent.create({
      data: {
        employeeId: e.id,
        type: type as never,
        startDate: day(start),
        endDate: end === null ? null : day(end),
        announcedAt: day(announced),
        note,
        createdById: admin,
      },
    });

  // ---- RED: people leaving for good / long absences inside the next 30–60 days
  await event(take("SEC", (e) => e.rank === 4), "RESIGNATION", 24, null, "Demisie depusă, preaviz 30 de zile. Pleacă la alt aeroport.", -6);
  await event(take("ATC", (e) => e.rank === 3), "RESIGNATION", 38, null, "Demisie; mutare în altă regiune.", -2);
  await event(take("CHK", (e) => e.rank >= 2), "MATERNITY", 12, 12 + 365, "Concediu de maternitate.", -20);
  await event(take("MET", (e) => (e.skills.get("MET_FC") ?? 0) >= 2), "SECONDMENT", 16, 76, "Detașare 2 luni la centrul regional de prognoză.", -10);
  await event(take("RMP", (e) => e.rank === 3), "RESIGNATION", 52, null, "A anunțat că pleacă după sezonul de iarnă.", -1);

  // fixed-term contracts ending soon (≈10% of the staff, mostly juniors)
  const contracts: [string, number][] = [["RMP", 21], ["BAG", 34], ["CHK", 47], ["GTE", 70], ["APR", 28], ["PRM", 95], ["SEC", 120], ["OCC", 160]];
  for (const [code, inDays] of contracts) {
    const e = take(code, (x) => x.rank <= 2);
    await prisma.employee.update({ where: { id: e.id }, data: { contractEndDate: day(inDays) } });
  }
  // a few more contract ends far away (green, just informative)
  for (const code of ["MNT", "BAG", "CHK", "RMP"]) {
    const e = take(code, (x) => x.rank <= 2);
    await prisma.employee.update({ where: { id: e.id }, data: { contractEndDate: day(200 + Math.floor(rand() * 200)) } });
  }

  // ---- ORANGE: planned leave / training inside the horizon
  const leaves: [string, number, number, string, string][] = [
    ["SEC", 6, 15, "LEAVE", "Concediu de odihnă aprobat."],
    ["RMP", 9, 14, "LEAVE", "Concediu de odihnă."],
    ["ATC", 20, 27, "LEAVE", "Concediu de odihnă."],
    ["APR", 4, 8, "TRAINING", "Curs recurent siguranță platformă."],
    ["OCC", 13, 22, "LEAVE", "Concediu de odihnă."],
    ["GTE", 2, 5, "TRAINING", "Curs DCS – versiune nouă."],
    ["MET", 25, 31, "LEAVE", "Concediu de odihnă."],
    ["BAG", 40, 49, "LEAVE", "Concediu planificat (iarnă)."],
  ];
  for (const [code, s, en, type, note] of leaves) await event(take(code, (e) => e.rank >= 2), type, s, en, note);

  // ---- manual overrides (the admin knows something the data doesn't)
  const ov1 = take("SEC", (e) => e.rank === 3);
  await prisma.readinessOverride.create({
    data: { employeeId: ov1.id, color: "ORANGE", reason: "A cerut transfer la check-in; discuție programată cu HR.", validUntil: day(30), setById: admin },
  });
  const ov2 = E.RMP.find((e) => used.has(e.id) && e.rank >= 2);
  if (ov2) {
    await prisma.readinessOverride.create({
      data: { employeeId: ov2.id, color: "GREEN", reason: "Concediul a fost reprogramat după sezonul de vârf.", validUntil: day(45), setById: admin },
    });
  }

  // ---- external candidate pool (fictional people; consent recorded at the event)
  type C = {
    first: string; last: string; uni: string; spec: string; year: number; ev: string; evDays: number;
    interests: string[]; skills: [string, number][]; from: number | null; status?: string; notes?: string;
  };
  const CANDS: C[] = [
    { first: "Matei", last: "Iordache", uni: "Universitatea Politehnica București", spec: "Inginerie aerospațială", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["ATC", "APR"], skills: [["ENG", 3], ["RADIO", 1]], from: 30, status: "CONTACTED", notes: "Echipa lui a câștigat locul 2; licență de radiotelefonie de la aeroclub." },
    { first: "Ilinca", last: "Marinescu", uni: "Universitatea din București", spec: "Fizică – meteorologie", year: 3, ev: "Prezentare carieră – Facultatea de Fizică", evDays: -40, interests: ["MET"], skills: [["ENG", 2], ["MET_FC", 1]], from: 20, status: "INTERVIEW", notes: "Practică la ANM vara trecută." },
    { first: "Rareș", last: "Neacșu", uni: "Școala Superioară de Aviație Civilă", spec: "Controlor de trafic aerian", year: 2, ev: "Ziua porților deschise ATC", evDays: -25, interests: ["ATC"], skills: [["ENG", 3], ["RADIO", 1], ["ATC_TWR", 1]], from: 60, status: "NEW" },
    { first: "Sara", last: "Grigore", uni: "Universitatea din Craiova", spec: "Inginerie electrică", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["MNT", "APR"], skills: [["ENG", 2]], from: 14, status: "NEW", notes: "Interesată de mentenanță echipamente de sol." },
    { first: "Victor", last: "Pavel", uni: "Academia Forțelor Aeriene „Henri Coandă”", spec: "Managementul traficului aerian", year: 3, ev: "Concurs „Aripi de student” 2026", evDays: -60, interests: ["ATC", "OCC"], skills: [["ENG", 3], ["RADIO", 1]], from: 45, status: "CONTACTED" },
    { first: "Denisa", last: "Chirilă", uni: "ASE București", spec: "Turism și servicii", year: 3, ev: "Târg de cariere ASE", evDays: -35, interests: ["CHK", "GTE", "PRM"], skills: [["ENG", 3], ["DCS", 1]], from: 7, status: "OFFER", notes: "A lucrat sezonier la un touroperator; poate începe imediat." },
    { first: "Paul", last: "Tănase", uni: "Universitatea Politehnica București", spec: "Transporturi – sisteme aeroportuare", year: 4, ev: "Prezentare carieră – Facultatea de Transporturi", evDays: -50, interests: ["APR", "OCC", "RMP"], skills: [["ENG", 2], ["AIRSIDE", 1]], from: 21, status: "INTERVIEW" },
    { first: "Bianca", last: "Sârbu", uni: "Universitatea de Vest Timișoara", spec: "Geografie – climatologie", year: 2, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 2]], from: 90, status: "NEW" },
    { first: "Ștefan", last: "Lazăr", uni: "Universitatea din Craiova", spec: "Automatică și calculatoare", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["OCC", "SEC"], skills: [["ENG", 3]], from: 30, status: "NEW", notes: "Bun la analiza datelor; potrivit pentru centrul operațional." },
    { first: "Teodora", last: "Mocanu", uni: "Academia de Poliție „Alexandru Ioan Cuza”", spec: "Ordine și siguranță publică", year: 3, ev: "Târg de cariere – siguranță", evDays: -28, interests: ["SEC"], skills: [["ENG", 2], ["AVSEC", 1]], from: 14, status: "CONTACTED", notes: "Curs AVSEC de bază absolvit." },
    { first: "Emil", last: "Dragomir", uni: "Universitatea Tehnică Cluj-Napoca", spec: "Ingineria autovehiculelor", year: 4, ev: "Concurs „Aripi de student” 2026", evDays: -60, interests: ["RMP", "MNT"], skills: [["ENG", 2], ["GPU", 1]], from: 10, status: "NEW" },
    { first: "Carla", last: "Munteanu", uni: "Universitatea din București", spec: "Limbi moderne aplicate", year: 3, ev: "Prezentare carieră – Facultatea de Limbi", evDays: -45, interests: ["CHK", "PRM", "GTE"], skills: [["ENG", 3], ["PRM", 1]], from: 7, status: "NEW", notes: "Voluntariat cu persoane cu dizabilități." },
    { first: "Horia", last: "Bucur", uni: "Școala Superioară de Aviație Civilă", spec: "Operațiuni aeroportuare", year: 2, ev: "Ziua porților deschise ATC", evDays: -25, interests: ["APR", "RMP"], skills: [["ENG", 2], ["AIRSIDE", 1], ["RADIO", 1]], from: 30, status: "INTERVIEW" },
    { first: "Livia", last: "Olteanu", uni: "Universitatea „Alexandru Ioan Cuza” Iași", spec: "Fizica atmosferei", year: 4, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 3], ["MET_FC", 1], ["MET_OBS", 1]], from: 30, status: "CONTACTED", notes: "Autorizare de observator obținută în practică." },
    { first: "Cezar", last: "Ivan", uni: "Universitatea din Craiova", spec: "Inginerie aerospațială", year: 3, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["ATC", "MNT"], skills: [["ENG", 2]], from: 120, status: "REJECTED", notes: "Vrea să-și termine întâi masterul; recontactăm în 2027." },
  ];
  for (const c of CANDS) {
    const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    await prisma.candidate.create({
      data: {
        firstName: c.first,
        lastName: c.last,
        email: `${slug(c.first)}.${slug(c.last)}@student.demo`,
        phone: `07${Math.floor(20000000 + rand() * 79999999)}`,
        university: c.uni,
        specialization: c.spec,
        studyYear: c.year >= 4 ? "Anul IV / absolvent 2027" : `Anul ${["I", "II", "III"][c.year - 1]}`,
        event: c.ev,
        eventDate: day(c.evDays),
        interests: c.interests,
        availableFrom: c.from === null ? null : day(c.from),
        consentAt: day(c.evDays),
        status: (c.status ?? "NEW") as never,
        notes: c.notes ?? null,
        skills: {
          create: c.skills.map(([code, p]) => ({
            skillId: skillId[code],
            proficiency: p,
            expiresAt: code === "RADIO" || code === "MET_OBS" || code === "AVSEC" ? day(400 + Math.floor(rand() * 300)) : null,
          })),
        },
      },
    });
  }
  console.log(`Team data: ${await prisma.availabilityEvent.count()} availability events, ${CANDS.length} candidates.`);
}
