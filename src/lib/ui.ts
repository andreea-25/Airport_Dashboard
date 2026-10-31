export const DEPT_COLORS: Record<string, { bg: string; text: string; border: string; hex: string }> = {
  CHK: { bg: "bg-sky-50", text: "text-sky-800", border: "border-sky-300", hex: "#0284c7" },
  SEC: { bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-300", hex: "#e11d48" },
  RMP: { bg: "bg-amber-50", text: "text-amber-900", border: "border-amber-300", hex: "#d97706" },
  BAG: { bg: "bg-lime-50", text: "text-lime-800", border: "border-lime-300", hex: "#65a30d" },
  PRM: { bg: "bg-violet-50", text: "text-violet-800", border: "border-violet-300", hex: "#7c3aed" },
  GTE: { bg: "bg-teal-50", text: "text-teal-800", border: "border-teal-300", hex: "#0d9488" },
  OCC: { bg: "bg-indigo-50", text: "text-indigo-800", border: "border-indigo-300", hex: "#4f46e5" },
  MNT: { bg: "bg-slate-100", text: "text-slate-800", border: "border-slate-300", hex: "#475569" },
  ATC: { bg: "bg-cyan-50", text: "text-cyan-900", border: "border-cyan-300", hex: "#0891b2" },
  MET: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-300", hex: "#2563eb" },
  APR: { bg: "bg-orange-50", text: "text-orange-900", border: "border-orange-300", hex: "#ea580c" },
};

export const READINESS_STYLES: Record<string, { dot: string; chip: string; label: string; hex: string }> = {
  GREEN: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800 border-emerald-300", label: "Verde", hex: "#10b981" },
  ORANGE: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 border-amber-300", label: "Portocaliu", hex: "#f59e0b" },
  RED: { dot: "bg-red-500", chip: "bg-red-50 text-red-800 border-red-300", label: "Roșu", hex: "#ef4444" },
};
export const deptColor = (code?: string | null) => DEPT_COLORS[code ?? ""] ?? DEPT_COLORS.MNT;

export function pctColor(pct: number) {
  if (pct >= 100) return "text-emerald-700 bg-emerald-50";
  if (pct >= 85) return "text-amber-800 bg-amber-50";
  return "text-red-700 bg-red-50";
}

export const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: "bg-sky-100 text-sky-800",
  IN_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  PENDING: "bg-sky-100 text-sky-800",
  APPLIED: "bg-emerald-100 text-emerald-800",
  DISMISSED: "bg-slate-100 text-slate-600",
};
