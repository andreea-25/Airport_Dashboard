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
