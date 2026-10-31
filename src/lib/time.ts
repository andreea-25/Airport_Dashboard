import { fromZonedTime, formatInTimeZone, toZonedTime } from "date-fns-tz";
import { ro as roLocale } from "date-fns/locale";

/** All timestamps are stored in UTC and displayed in this zone. */
export const TZ = "Europe/Bucharest";

/** "2026-10-30" + "06:00" (local) -> UTC Date */
export function localToUtc(dateStr: string, time: string): Date {
  return fromZonedTime(`${dateStr}T${time}:00`, TZ);
}

/** UTC Date -> "yyyy-MM-dd" in local zone */
export function localDateStr(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function localTimeStr(d: Date): string {
  return formatInTimeZone(d, TZ, "HH:mm");
}

export function fmt(d: Date, pattern: string): string {
  return formatInTimeZone(d, TZ, pattern, { locale: roLocale });
}

/** Local hour 0..23 */
export function localHour(d: Date): number {
  return toZonedTime(d, TZ).getHours();
}

/** ISO day of week in local zone: 1 = Monday ... 7 = Sunday */
export function localIsoDow(d: Date): number {
  const day = toZonedTime(d, TZ).getDay();
  return day === 0 ? 7 : day;
}

/** Add n days to a "yyyy-MM-dd" string. */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Monday ("yyyy-MM-dd") of the local week containing d. */
export function mondayOf(d: Date): string {
  const s = localDateStr(d);
  return addDaysStr(s, -(localIsoDow(d) - 1));
}

/** Start of local day as UTC instant. */
export function startOfLocalDay(dateStr: string): Date {
  return localToUtc(dateStr, "00:00");
}

/** Shift interval from a local date + "HH:mm" start/end; end <= start means it ends next day. */
export function shiftInterval(dateStr: string, start: string, end: string): { startAt: Date; endAt: Date } {
  const startAt = localToUtc(dateStr, start);
  const endDate = end <= start ? addDaysStr(dateStr, 1) : dateStr;
  const endAt = localToUtc(endDate, end === "24:00" ? "00:00" : end);
  return { startAt, endAt };
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/** Date column (@db.Date) value for a local date string. */
export function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Fast cached local-time info (the simulation engine calls this thousands of times per evaluation;
// shift boundaries fall on a small set of instants, so a cache makes it almost free).
// ---------------------------------------------------------------------------
export type LocalInfo = { hour: number; dow: number; date: string; monday: string; time: string };
const infoCache = new Map<number, LocalInfo>();

export function localInfo(d: Date | number): LocalInfo {
  const ms = typeof d === "number" ? d : d.getTime();
  let v = infoCache.get(ms);
  if (!v) {
    const date = new Date(ms);
    const dow = localIsoDow(date);
    const dateStr = localDateStr(date);
    v = { hour: localHour(date), dow, date: dateStr, monday: addDaysStr(dateStr, -(dow - 1)), time: localTimeStr(date) };
    if (infoCache.size > 50_000) infoCache.clear();
    infoCache.set(ms, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Named periods ("weekend", "next week"…) computed by code, so the AI never does date arithmetic.
// ---------------------------------------------------------------------------
export const SHIFT_PERIODS = ["azi", "maine", "weekend", "saptamana_aceasta", "saptamana_viitoare", "urmatoarele_14_zile"] as const;
export type ShiftPeriod = (typeof SHIFT_PERIODS)[number];

export function periodRange(period: ShiftPeriod, today: string = localDateStr(new Date())): { from: string; to: string; label: string } {
  const dow = localIsoDow(localToUtc(today, "12:00")); // 1 = Monday … 7 = Sunday
  const d = (n: number) => addDaysStr(today, n);
  switch (period) {
    case "azi":
      return { from: today, to: today, label: "azi" };
    case "maine":
      return { from: d(1), to: d(1), label: "mâine" };
    case "weekend":
      if (dow === 6) return { from: today, to: d(1), label: "weekendul acesta" };
      if (dow === 7) return { from: today, to: today, label: "azi (duminică)" };
      return { from: d(6 - dow), to: d(7 - dow), label: "weekendul acesta" };
    case "saptamana_aceasta":
      return { from: today, to: d(7 - dow), label: "săptămâna aceasta" };
    case "saptamana_viitoare":
      return { from: d(8 - dow), to: d(14 - dow), label: "săptămâna viitoare" };
    case "urmatoarele_14_zile":
    default:
      return { from: today, to: d(13), label: "următoarele 14 zile" };
  }
}

/** Ready-made calendar for the AI prompt (so it can copy dates instead of computing them). */
export function promptCalendar(at: Date = new Date()): string {
  const today = localDateStr(at);
  const fmtR = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const rows = SHIFT_PERIODS.map((p) => {
    const r = periodRange(p, today);
    return `- ${p}: ${r.from === r.to ? fmtR(r.from) : `${fmtR(r.from)} – ${fmtR(r.to)}`} (from=${r.from}, to=${r.to})`;
  });
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = addDaysStr(today, i);
    return `${fmt(localToUtc(d, "12:00"), "EEEE")} ${fmtR(d)} (${d})`;
  });
  return `${rows.join("\n")}\nUrmătoarele zile: ${days.join("; ")}`;
}
