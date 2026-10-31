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

  await seedRecruiting({
    now,
    admin,
    skillId,
    rand,
    // juniors that were "hired through a project": a first-level employee not used by the scenarios above
    pickHired: async (code) => {
      const info = E[code]?.find((x) => x.rank === 1 && !used.has(x.id)) ?? E[code]?.find((x) => x.rank <= 2 && !used.has(x.id));
      if (!info) return null;
      used.add(info.id);
      return info.id;
    },
  });
  console.log(`Team data: ${await prisma.availabilityEvent.count()} availability events.`);
}

/**
 * Candidates (Craiova faculties + aviation schools), recruiting projects, juniors hired through projects and
 * former employees. Idempotent: anything that already exists (same title / email) is left alone, so it can also run
 * on an existing database (scripts/seed-extra.ts) without touching your data.
 */
export async function seedRecruiting(opts: {
  now: Date;
  admin: string | null;
  skillId: Record<string, string>;
  rand: () => number;
  pickHired: (deptCode: string) => Promise<string | null>;
}) {
  const { now, admin, skillId, rand, pickHired } = opts;
  const today = localDateStr(now);
  const day = (n: number) => dateOnly(addDaysStr(today, n));
  // ---- external candidate pool (fictional people; consent recorded at the event)
  type C = {
    first: string; last: string; uni: string; spec: string; year: number; ev: string; evDays: number;
    interests: string[]; skills: [string, number][]; from: number | null; status?: string; notes?: string;
  };
  const CANDS: C[] = [
    { first: "Matei", last: "Iordache", uni: "Universitatea Politehnica București", spec: "Inginerie aerospațială", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["ATC", "APR"], skills: [["ENG", 3], ["RADIO", 1]], from: 30, status: "CONTACTED", notes: "Echipa lui a câștigat locul 2; licență de radiotelefonie de la aeroclub." },
    { first: "Ilinca", last: "Marinescu", uni: "Universitatea din București", spec: "Fizică – meteorologie", year: 3, ev: "Prezentare carieră – Facultatea de Fizică", evDays: -40, interests: ["MET"], skills: [["ENG", 2], ["MET_FC", 1]], from: 20, status: "INTERVIEW", notes: "Practică la ANM vara trecută." },
    { first: "Rareș", last: "Neacșu", uni: "Școala Superioară de Aviație Civilă", spec: "Controlor de trafic aerian", year: 2, ev: "Ziua porților deschise ATC", evDays: -25, interests: ["ATC"], skills: [["ENG", 3], ["RADIO", 1], ["ATC_TWR", 1]], from: 60, status: "NEW" },
    { first: "Sara", last: "Grigore", uni: "Universitatea din Craiova – Facultatea de Inginerie Electrică", spec: "Electromecanică", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["MNT", "APR"], skills: [["ENG", 2]], from: 14, status: "NEW", notes: "Interesată de mentenanță echipamente de sol." },
    { first: "Victor", last: "Pavel", uni: "Academia Forțelor Aeriene „Henri Coandă”", spec: "Managementul traficului aerian", year: 3, ev: "Concurs „Aripi de student” 2026", evDays: -60, interests: ["ATC", "OCC"], skills: [["ENG", 3], ["RADIO", 1]], from: 45, status: "CONTACTED" },
    { first: "Denisa", last: "Chirilă", uni: "ASE București", spec: "Turism și servicii", year: 3, ev: "Târg de cariere ASE", evDays: -35, interests: ["CHK", "GTE", "PRM"], skills: [["ENG", 3], ["DCS", 1]], from: 7, status: "OFFER", notes: "A lucrat sezonier la un touroperator; poate începe imediat." },
    { first: "Paul", last: "Tănase", uni: "Universitatea Politehnica București", spec: "Transporturi – sisteme aeroportuare", year: 4, ev: "Prezentare carieră – Facultatea de Transporturi", evDays: -50, interests: ["APR", "OCC", "RMP"], skills: [["ENG", 2], ["AIRSIDE", 1]], from: 21, status: "INTERVIEW" },
    { first: "Bianca", last: "Sârbu", uni: "Universitatea de Vest Timișoara", spec: "Geografie – climatologie", year: 2, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 2]], from: 90, status: "NEW" },
    { first: "Ștefan", last: "Lazăr", uni: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", spec: "Calculatoare", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["OCC", "SEC"], skills: [["ENG", 3]], from: 30, status: "NEW", notes: "Bun la analiza datelor; potrivit pentru centrul operațional." },
    { first: "Teodora", last: "Mocanu", uni: "Academia de Poliție „Alexandru Ioan Cuza”", spec: "Ordine și siguranță publică", year: 3, ev: "Târg de cariere – siguranță", evDays: -28, interests: ["SEC"], skills: [["ENG", 2], ["AVSEC", 1]], from: 14, status: "CONTACTED", notes: "Curs AVSEC de bază absolvit." },
    { first: "Emil", last: "Dragomir", uni: "Universitatea Tehnică Cluj-Napoca", spec: "Ingineria autovehiculelor", year: 4, ev: "Concurs „Aripi de student” 2026", evDays: -60, interests: ["RMP", "MNT"], skills: [["ENG", 2], ["GPU", 1]], from: 10, status: "NEW" },
    { first: "Carla", last: "Munteanu", uni: "Universitatea din București", spec: "Limbi moderne aplicate", year: 3, ev: "Prezentare carieră – Facultatea de Limbi", evDays: -45, interests: ["CHK", "PRM", "GTE"], skills: [["ENG", 3], ["PRM", 1]], from: 7, status: "NEW", notes: "Voluntariat cu persoane cu dizabilități." },
    { first: "Horia", last: "Bucur", uni: "Școala Superioară de Aviație Civilă", spec: "Operațiuni aeroportuare", year: 2, ev: "Ziua porților deschise ATC", evDays: -25, interests: ["APR", "RMP"], skills: [["ENG", 2], ["AIRSIDE", 1], ["RADIO", 1]], from: 30, status: "INTERVIEW" },
    { first: "Livia", last: "Olteanu", uni: "Universitatea „Alexandru Ioan Cuza” Iași", spec: "Fizica atmosferei", year: 4, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 3], ["MET_FC", 1], ["MET_OBS", 1]], from: 30, status: "CONTACTED", notes: "Autorizare de observator obținută în practică." },
    { first: "Cezar", last: "Ivan", uni: "Universitatea din Craiova – Facultatea de Mecanică", spec: "Ingineria transporturilor", year: 3, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["ATC", "MNT"], skills: [["ENG", 2]], from: 120, status: "REJECTED", notes: "Vrea să-și termine întâi masterul; recontactăm în 2027." },
    // ---- people met through projects with Craiova faculties and schools (fictional people, real institution types)
    { first: "Andrei", last: "Pătrașcu", uni: "Universitatea din Craiova – Facultatea de Mecanică", spec: "Autovehicule rutiere", year: 4, ev: "Prezentare: meserii în aeroport (Mecanică)", evDays: -30, interests: ["RMP", "MNT"], skills: [["ENG", 2], ["GPU", 1]], from: 14, status: "CONTACTED", notes: "Permis categoria C; a lucrat vara într-un service auto." },
    { first: "Roxana", last: "Bărbulescu", uni: "Universitatea din Craiova – Facultatea de Mecanică", spec: "Ingineria transporturilor și a traficului", year: 3, ev: "Prezentare: meserii în aeroport (Mecanică)", evDays: -30, interests: ["APR", "OCC"], skills: [["ENG", 2]], from: 60, status: "NEW" },
    { first: "Mihnea", last: "Stănescu", uni: "Universitatea din Craiova – Facultatea de Inginerie Electrică", spec: "Electromecanică", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["MNT"], skills: [["ENG", 2], ["GPU", 1]], from: 21, status: "INTERVIEW", notes: "Proiect de licență despre sisteme de alimentare la sol." },
    { first: "Daria", last: "Popovici", uni: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", spec: "Automatică și informatică aplicată", year: 4, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["OCC", "ATC"], skills: [["ENG", 3]], from: 30, status: "CONTACTED", notes: "A construit în echipă un panou de monitorizare a zborurilor." },
    { first: "Tudor", last: "Mitrea", uni: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", spec: "Electronică aplicată", year: 3, ev: "Curs de radiotelefonie pentru studenți", evDays: -5, interests: ["ATC", "APR"], skills: [["ENG", 3], ["RADIO", 1]], from: 45, status: "NEW", notes: "Radioamator autorizat." },
    { first: "Alexia", last: "Dobrescu", uni: "Universitatea din Craiova – Facultatea de Științe", spec: "Geografie (climatologie)", year: 3, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 2], ["MET_FC", 1]], from: 30, status: "CONTACTED", notes: "Lucrează la stația meteo a facultății." },
    { first: "Radu", last: "Cârstea", uni: "Universitatea din Craiova – Facultatea de Științe", spec: "Fizică", year: 4, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET", "ATC"], skills: [["ENG", 3]], from: 30, status: "NEW" },
    { first: "Georgiana", last: "Velcu", uni: "Universitatea din Craiova – Facultatea de Litere", spec: "Limbi moderne aplicate (engleză–franceză)", year: 3, ev: "Prezentare: cariere în servicii pentru pasageri (Litere)", evDays: -20, interests: ["CHK", "GTE", "PRM"], skills: [["ENG", 3], ["DCS", 1]], from: 7, status: "INTERVIEW" },
    { first: "Ionela", last: "Fieraru", uni: "Universitatea din Craiova – Facultatea de Litere", spec: "Limbi moderne aplicate (engleză–germană)", year: 2, ev: "Prezentare: cariere în servicii pentru pasageri (Litere)", evDays: -20, interests: ["GTE", "CHK"], skills: [["ENG", 3]], from: 180, status: "NEW", notes: "Disponibilă doar în vacanța de vară (sezonier)." },
    { first: "Cosmin", last: "Năstase", uni: "Universitatea din Craiova – Facultatea de Economie și Administrarea Afacerilor", spec: "Economia comerțului, turismului și serviciilor", year: 4, ev: "Prezentare: cariere în servicii pentru pasageri (Litere)", evDays: -20, interests: ["CHK", "OCC"], skills: [["ENG", 2], ["DCS", 1]], from: 14, status: "NEW" },
    { first: "Bogdana", last: "Ilie", uni: "Universitatea din Craiova – Facultatea de Drept", spec: "Drept", year: 4, ev: "Prezentare: securitatea aviației ca profesie", evDays: -8, interests: ["SEC"], skills: [["ENG", 2]], from: 30, status: "CONTACTED", notes: "Interesată de controlul de securitate și legislația aviatică." },
    { first: "Florin", last: "Ungureanu", uni: "Universitatea din Craiova – Facultatea de Educație Fizică și Sport", spec: "Kinetoterapie", year: 3, ev: "Prezentare: asistență pentru pasagerii cu mobilitate redusă", evDays: -12, interests: ["PRM"], skills: [["ENG", 2], ["FIRSTAID", 1]], from: 14, status: "INTERVIEW", notes: "Voluntar la competiții paralimpice." },
    { first: "Medeea", last: "Turcu", uni: "Universitatea de Medicină și Farmacie din Craiova", spec: "Asistență medicală generală", year: 3, ev: "Prezentare: asistență pentru pasagerii cu mobilitate redusă", evDays: -12, interests: ["PRM", "CHK"], skills: [["ENG", 2], ["FIRSTAID", 1], ["PRM", 1]], from: 21, status: "OFFER" },
    { first: "Valentin", last: "Ciurea", uni: "Liceul Tehnologic de transporturi auto Craiova", spec: "Mecanic auto (absolvent)", year: 4, ev: "Zi deschisă pe platformă", evDays: -40, interests: ["RMP", "BAG"], skills: [["GPU", 1], ["BELT", 1]], from: 7, status: "CONTACTED", notes: "Absolvent 2026, permis categoria B." },
    { first: "Sorina", last: "Dumitrescu", uni: "Liceul Tehnologic de transporturi auto Craiova", spec: "Tehnician transporturi (absolvent)", year: 4, ev: "Zi deschisă pe platformă", evDays: -40, interests: ["BAG", "RMP"], skills: [["BELT", 1]], from: 7, status: "NEW" },
    { first: "Adelina", last: "Marcu", uni: "Școala Superioară de Aviație Civilă", spec: "Controlor de trafic aerian (din Craiova)", year: 3, ev: "Ziua porților deschise ATC", evDays: -25, interests: ["ATC"], skills: [["ENG", 3], ["RADIO", 1], ["ATC_TWR", 1]], from: 90, status: "INTERVIEW", notes: "Vrea să se întoarcă acasă în Craiova după școală." },
    { first: "Eduard", last: "Bratu", uni: "Universitatea din București – Facultatea de Fizică", spec: "Fizica atmosferei și meteorologie (master)", year: 4, ev: "Webinar „Meteorologia în aviație”", evDays: -15, interests: ["MET"], skills: [["ENG", 3], ["MET_FC", 2], ["MET_OBS", 1]], from: 45, status: "OFFER", notes: "Originar din Dolj; caută post aproape de casă." },
    { first: "Patricia", last: "Enescu", uni: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", spec: "Calculatoare", year: 2, ev: "Hackathon Aeroport 2026", evDays: -1, interests: ["OCC"], skills: [["ENG", 3]], from: 240, status: "NEW", notes: "Ar vrea un internship de vară." },
  ];

  // ---- recruiting projects: done ones (where we met the candidates above) + planned / proposed ones
  type P = { title: string; type: string; inst: string; depts: string[]; start: number | null; end?: number | null; status: string; reach?: number; desc: string };
  const PROJECTS: P[] = [
    { title: "Hackathon Aeroport 2026", type: "HACKATHON", inst: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", depts: ["OCC", "ATC", "APR", "MNT"], start: -2, end: -1, status: "DONE", reach: 80, desc: "Două zile de proiecte pe date reale (anonimizate) ale aeroportului; mentori din AOCC și mentenanță." },
    { title: "Prezentare: meserii în aeroport (Mecanică)", type: "PRESENTATION", inst: "Universitatea din Craiova – Facultatea de Mecanică", depts: ["RMP", "MNT", "APR"], start: -30, status: "DONE", reach: 60, desc: "Handling, mentenanța echipamentelor de sol și coordonarea platformei, prezentate de șefii de tură." },
    { title: "Prezentare: cariere în servicii pentru pasageri (Litere)", type: "PRESENTATION", inst: "Universitatea din Craiova – Facultatea de Litere", depts: ["CHK", "GTE", "PRM"], start: -20, status: "DONE", reach: 45, desc: "Check-in, îmbarcare și asistență PRM: limbi străine, lucru cu pasagerii, program în ture." },
    { title: "Prezentare: securitatea aviației ca profesie", type: "PRESENTATION", inst: "Universitatea din Craiova – Facultatea de Drept", depts: ["SEC"], start: -8, status: "DONE", reach: 40, desc: "Ce face un agent de securitate aeroportuară, certificarea AVSEC, parcursul spre șef de tură." },
    { title: "Prezentare: asistență pentru pasagerii cu mobilitate redusă", type: "PRESENTATION", inst: "Universitatea de Medicină și Farmacie din Craiova", depts: ["PRM"], start: -12, status: "DONE", reach: 35, desc: "Împreună cu Facultatea de Educație Fizică și Sport (kinetoterapie)." },
    { title: "Zi deschisă pe platformă", type: "OPEN_DAY", inst: "Liceul Tehnologic de transporturi auto Craiova", depts: ["RMP", "BAG"], start: -40, status: "DONE", reach: 30, desc: "Vizită ghidată pe platformă pentru elevii din anul terminal și absolvenți." },
    { title: "Ziua porților deschise ATC", type: "OPEN_DAY", inst: "Școala Superioară de Aviație Civilă + studenți din Craiova", depts: ["ATC", "APR"], start: -25, status: "DONE", reach: 25, desc: "Vizită în turnul de control și discuții cu controlorii." },
    { title: "Webinar „Meteorologia în aviație”", type: "WEBINAR", inst: "Online – facultăți de fizică și geografie (Craiova, București, Iași, Timișoara)", depts: ["MET"], start: -15, status: "DONE", reach: 120, desc: "METAR/TAF, observații la aerodrom, cum devii meteorolog aeronautic." },
    { title: "Curs de radiotelefonie pentru studenți", type: "COURSE", inst: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", depts: ["ATC", "APR"], start: -5, end: 25, status: "ONGOING", reach: 20, desc: "Curs opțional de 4 săptămâni: frazeologie, engleză aeronautică, simulări de comunicare." },
    { title: "Concurs „Aripi de student” 2026", type: "COMPETITION", inst: "Concurs național de proiecte aeronautice", depts: ["ATC", "OCC", "MNT"], start: -60, status: "DONE", reach: 150, desc: "Am susținut un premiu special și am cunoscut finaliștii." },
    { title: "Stagiu de practică – vara 2027 (handling și platformă)", type: "INTERNSHIP", inst: "Universitatea din Craiova – Facultatea de Mecanică", depts: ["RMP", "BAG", "APR"], start: 220, end: 280, status: "PLANNED", reach: 12, desc: "Practică plătită de 6 săptămâni, cu mentor din echipă; cei mai buni primesc ofertă." },
    { title: "Concurs de prognoză meteo aeronautică", type: "COMPETITION", inst: "Universitatea din Craiova – Facultatea de Științe (Geografie, Fizică)", depts: ["MET"], start: 75, status: "PROPOSED", reach: 30, desc: "Studenții fac prognoze TAF pentru aeroport timp de o lună; comparăm cu observațiile reale." },
  ];
  const projectId: Record<string, string> = {};
  for (const pr of PROJECTS) {
    const existing = await prisma.recruitingProject.findFirst({ where: { title: pr.title } });
    if (existing) {
      projectId[pr.title] = existing.id;
      continue;
    }
    const created = await prisma.recruitingProject.create({
      data: {
        title: pr.title,
        type: pr.type as never,
        institution: pr.inst,
        targetDepartments: pr.depts,
        startDate: pr.start === null ? null : day(pr.start),
        endDate: pr.end == null ? null : day(pr.end),
        status: pr.status as never,
        description: pr.desc,
        expectedReach: pr.reach ?? null,
        createdById: admin,
      },
    });
    projectId[pr.title] = created.id;
  }

  let added = 0;
  for (const c of CANDS) {
    const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const email = `${slug(c.first)}.${slug(c.last)}@student.demo`;
    const existing = await prisma.candidate.findUnique({ where: { email } });
    if (existing) {
      if (!existing.projectId && projectId[c.ev]) await prisma.candidate.update({ where: { id: existing.id }, data: { projectId: projectId[c.ev] } });
      continue;
    }
    added++;
    await prisma.candidate.create({
      data: {
        firstName: c.first,
        lastName: c.last,
        email,
        phone: `07${Math.floor(20000000 + rand() * 79999999)}`,
        university: c.uni,
        specialization: c.spec,
        studyYear: c.year >= 4 ? "Anul IV / absolvent 2027" : `Anul ${["I", "II", "III"][c.year - 1]}`,
        event: c.ev,
        eventDate: day(c.evDays),
        projectId: projectId[c.ev] ?? null,
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
  // ---- a few juniors hired through past projects (so the project statistics show real conversions)
  const hiredVia: [string, string, string, string][] = [
    ["RMP", "Prezentare: meserii în aeroport (Mecanică)", "Universitatea din Craiova – Facultatea de Mecanică", "Autovehicule rutiere"],
    ["BAG", "Zi deschisă pe platformă", "Liceul Tehnologic de transporturi auto Craiova", "Tehnician transporturi (absolvent)"],
    ["CHK", "Prezentare: cariere în servicii pentru pasageri (Litere)", "Universitatea din Craiova – Facultatea de Litere", "Limbi moderne aplicate (engleză–spaniolă)"],
  ];
  for (const [code, ev, uni, spec] of hiredVia) {
    if (!projectId[ev] || (await prisma.candidate.findFirst({ where: { projectId: projectId[ev], status: "HIRED" } }))) continue;
    const empId = await pickHired(code);
    if (!empId) continue;
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: empId } });
    const pr = PROJECTS.find((x) => x.title === ev)!;
    // hired two weeks after the project
    await prisma.employee.update({ where: { id: emp.id }, data: { hireDate: day((pr.start ?? -30) + 14), levelSince: day((pr.start ?? -30) + 14) } });
    await prisma.candidate.create({
      data: {
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: `${emp.email.split("@")[0]}@student.demo`,
        university: uni,
        specialization: spec,
        studyYear: "Absolvent",
        event: ev,
        eventDate: day(pr.start ?? -30),
        projectId: projectId[ev],
        interests: [code],
        consentAt: day(pr.start ?? -30),
        status: "HIRED",
        hiredEmployeeId: emp.id,
        notes: "Angajat după proiect.",
      },
    });
  }

  // ---- former employees (inactive): why they left and whether we'd hire them again
  const [levels, depts] = await Promise.all([prisma.level.findMany(), prisma.department.findMany({ include: { teams: { orderBy: { name: "asc" } } } })]);
  const lv = (rank: number) => levels.find((l) => l.rank === rank)!.id;
  type F = { first: string; last: string; dept: string; team: number; rank: number; years: number; leftDays: number; reason: string; eligible: boolean; note: string; skills: [string, number, number | null][] };
  // skills: [code, proficiency, expires in N days from today (negative = already expired) | null]
  const FORMER: F[] = [
    { first: "Marian", last: "Văduva", dept: "ATC", team: 0, rank: 3, years: 9, leftDays: -120, reason: "RESIGNATION", eligible: true, note: "S-a mutat la Sibiu din motive familiale; a spus că s-ar întoarce în Craiova.", skills: [["ATC_LIC", 1, -20], ["ATC_TWR", 3, null], ["RADIO", 1, 200], ["ENG", 3, null], ["FIRSTAID", 1, -60]] },
    { first: "Camelia", last: "Rădulescu", dept: "MET", team: 1, rank: 3, years: 7, leftDays: -200, reason: "OTHER", eligible: true, note: "A plecat pentru un doctorat în meteorologie; îl termină în primăvară.", skills: [["MET_OBS", 1, -90], ["MET_FC", 3, null], ["ENG", 3, null]] },
    { first: "Sergiu", last: "Pîrvu", dept: "SEC", team: 2, rank: 2, years: 3, leftDays: -60, reason: "CONTRACT_END", eligible: true, note: "Contract pe perioadă determinată (sezon); evaluare bună.", skills: [["AVSEC", 1, 150], ["XRAY", 2, null], ["ETD", 1, null], ["ENG", 1, null]] },
    { first: "Nicoleta", last: "Gogoașă", dept: "APR", team: 1, rank: 2, years: 4, leftDays: -45, reason: "RESIGNATION", eligible: true, note: "A plecat în privat (logistică); a lăsat ușa deschisă.", skills: [["APRON", 2, null], ["RADIO", 1, 300], ["AIRSIDE", 1, 90], ["ENG", 2, null]] },
    { first: "Dorin", last: "Câmpeanu", dept: "RMP", team: 1, rank: 4, years: 22, leftDays: -300, reason: "RETIREMENT", eligible: true, note: "Pensionat; disponibil part-time ca instructor pushback.", skills: [["AIRSIDE", 1, -100], ["PUSHBACK", 3, -100], ["DGR", 1, -150], ["TEAMCOORD", 3, null], ["ENG", 2, null], ["GPU", 3, null]] },
    { first: "Laurențiu", last: "Bobic", dept: "CHK", team: 0, rank: 1, years: 1, leftDays: -90, reason: "OTHER", eligible: false, note: "Contract încetat după abateri repetate de la procedurile de check-in.", skills: [["DCS", 1, null], ["ENG", 2, null]] },
  ];
  let formerAdded = 0;
  for (const f of FORMER) {
    const email = `${f.first}.${f.last}.fost@aeroport.demo`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (await prisma.employee.findUnique({ where: { email } })) continue;
    formerAdded++;
    const d = depts.find((x) => x.code === f.dept)!;
    const left = day(f.leftDays);
    const hire = new Date(left.getTime() - f.years * 365 * 86400000);
    await prisma.employee.create({
      data: {
        firstName: f.first,
        lastName: f.last,
        email,
        phone: `07${Math.floor(20000000 + rand() * 79999999)}`,
        departmentId: d.id,
        teamId: d.teams[f.team]?.id ?? null,
        levelId: lv(f.rank),
        hireDate: hire,
        levelSince: hire,
        active: false,
        leftAt: left,
        leaveReason: f.reason,
        rehireEligible: f.eligible,
        leaveNote: f.note,
        skills: {
          create: f.skills.map(([code, p, exp]) => ({ skillId: skillId[code], proficiency: p, obtainedAt: hire, expiresAt: exp === null ? null : day(exp) })),
        },
      },
    });
  }
  console.log(`Recruiting data: +${added} candidates, ${PROJECTS.length} projects, +${formerAdded} former employees.`);
}
