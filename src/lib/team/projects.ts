// Recruiting projects: courses, presentations, competitions… with faculties, to meet future employees.
// Statistics per project (candidates met, in progress, hired) and automatic suggestions for the departments
// that are short of people.
import { prisma } from "@/lib/db";
import { computeAll, type TeamData } from "./readiness";

export const PROJECT_TYPES: Record<string, string> = {
  COURSE: "Curs",
  PRESENTATION: "Prezentare",
  COMPETITION: "Competiție / concurs",
  HACKATHON: "Hackathon",
  INTERNSHIP: "Stagiu de practică",
  OPEN_DAY: "Zi porți deschise",
  WEBINAR: "Webinar",
};
export const PROJECT_STATUSES: Record<string, string> = {
  PROPOSED: "Propus",
  PLANNED: "Planificat",
  ONGOING: "În desfășurare",
  DONE: "Încheiat",
  CANCELLED: "Anulat",
};

export async function loadProjects() {
  const projects = await prisma.recruitingProject.findMany({
    include: { candidates: { select: { id: true, firstName: true, lastName: true, status: true } } },
    orderBy: [{ startDate: "desc" }],
  });
  return projects.map((p) => ({
    ...p,
    stats: {
      candidates: p.candidates.length,
      inProgress: p.candidates.filter((c) => ["CONTACTED", "INTERVIEW", "OFFER"].includes(c.status)).length,
      hired: p.candidates.filter((c) => c.status === "HIRED").length,
    },
  }));
}
export type ProjectRow = Awaited<ReturnType<typeof loadProjects>>[number];

/** What has worked for a department / institution before, and what to propose. Templates are tied to the
 *  Craiova area (Universitatea din Craiova faculties, UMF, technical high schools) plus national aviation schools. */
const TEMPLATES: Record<string, { title: string; type: string; institution: string; why: string; reach: number }> = {
  ATC: { title: "Curs de radiotelefonie + vizită în turnul de control", type: "COURSE", institution: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică + Școala Superioară de Aviație Civilă", why: "licența de controlor durează ~240 de zile: candidații trebuie găsiți cu mult înainte", reach: 25 },
  MET: { title: "Concurs de prognoză meteo aeronautică", type: "COMPETITION", institution: "Universitatea din Craiova – Facultatea de Științe (Geografie, Fizică)", why: "observatorii și prognoziștii se formează în 2–4 luni", reach: 30 },
  APR: { title: "Prezentare: coordonarea platformei și a standurilor", type: "PRESENTATION", institution: "Universitatea din Craiova – Facultatea de Mecanică (Ingineria transporturilor)", why: "profil apropiat: trafic, logistică, transporturi", reach: 40 },
  SEC: { title: "Prezentare: securitatea aviației ca profesie", type: "PRESENTATION", institution: "Universitatea din Craiova – Facultatea de Drept", why: "certificarea AVSEC + raze X se obțin în ~5 săptămâni", reach: 40 },
  RMP: { title: "Zi deschisă pe platformă pentru absolvenți", type: "OPEN_DAY", institution: "Liceul Tehnologic de transporturi auto Craiova", why: "absolvenți cu profil tehnic, pot începe repede", reach: 30 },
  BAG: { title: "Zi deschisă: sortarea bagajelor", type: "OPEN_DAY", institution: "Liceul Tehnologic de transporturi auto Craiova", why: "pregătire scurtă (bandă bagaje: 3 zile)", reach: 25 },
  MNT: { title: "Stagiu de practică în mentenanța echipamentelor de sol", type: "INTERNSHIP", institution: "Universitatea din Craiova – Facultatea de Inginerie Electrică", why: "electromecanicii se potrivesc direct pe posturile de tehnician", reach: 10 },
  CHK: { title: "Prezentare: cariere în servicii pentru pasageri", type: "PRESENTATION", institution: "Universitatea din Craiova – Facultatea de Litere (Limbi moderne aplicate)", why: "limbile străine sunt cerința principală; DCS se învață în ~7 zile", reach: 45 },
  GTE: { title: "Prezentare: îmbarcare și informații pasageri", type: "PRESENTATION", institution: "Universitatea din Craiova – Facultatea de Economie și Administrarea Afacerilor (Turism)", why: "profil de servicii și turism", reach: 40 },
  PRM: { title: "Prezentare: asistență pentru pasagerii cu mobilitate redusă", type: "PRESENTATION", institution: "Universitatea de Medicină și Farmacie din Craiova + Facultatea de Educație Fizică și Sport", why: "asistenți medicali și kinetoterapeuți au deja prim-ajutor", reach: 35 },
  OCC: { title: "Hackathon pe operațiunile aeroportului", type: "HACKATHON", institution: "Universitatea din Craiova – Facultatea de Automatică, Calculatoare și Electronică", why: "dispecerii lucrează cu date și sisteme; hackathonul arată cine se descurcă", reach: 60 },
};

export type ProjectSuggestion = {
  deptCode: string;
  deptName: string;
  reason: string;
  title: string;
  type: string;
  institution: string;
  why: string;
  reach: number;
  /** what similar past projects (same department) produced */
  history: string | null;
};

export function suggestProjects(data: TeamData, projects: ProjectRow[], horizon = 60): ProjectSuggestion[] {
  const { balance } = computeAll(data, horizon);
  const pending = projects.filter((p) => ["PROPOSED", "PLANNED", "ONGOING"].includes(p.status));
  const out: ProjectSuggestion[] = [];
  for (const b of [...balance].sort((x, y) => x.margin - y.margin)) {
    const t = TEMPLATES[b.code];
    if (!t) continue;
    const short = b.margin < 0;
    const critical = b.critical.filter((c) => c.greenHolders < c.needed);
    if (!short && critical.length === 0 && b.status !== "RED") continue;
    // already covered by a project in progress for this department
    if (pending.some((p) => p.targetDepartments.includes(b.code))) continue;
    const past = projects.filter((p) => p.status === "DONE" && p.targetDepartments.includes(b.code));
    const met = past.reduce((a, p) => a + p.stats.candidates, 0);
    const hired = past.reduce((a, p) => a + p.stats.hired, 0);
    const reason = [
      short ? `${-b.margin} ${b.margin === -1 ? "om" : "oameni"} sub necesar în ${horizon} de zile` : null,
      critical.length ? `competențe critice: ${critical.map((c) => c.name).join(", ")}` : null,
      !short && !critical.length ? "departament pe roșu" : null,
    ]
      .filter(Boolean)
      .join("; ");
    out.push({
      deptCode: b.code,
      deptName: b.name,
      reason,
      ...t,
      history: past.length ? `${past.length} ${past.length === 1 ? "proiect încheiat" : "proiecte încheiate"} pentru ${b.code}: ${met} candidați, ${hired} angajați` : null,
    });
  }
  return out;
}
