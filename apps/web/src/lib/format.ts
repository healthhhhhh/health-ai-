/** Pure formatting helpers — no React, fully unit-tested. */

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export function greeting(hour: number, firstName?: string): string {
  const part = dayPart(hour);
  const base = `Good ${part[0]!.toUpperCase()}${part.slice(1)}`;
  return firstName ? `${base}, ${firstName}` : base;
}

/** The hour (0–23) of `date` in an IANA time zone. Falls back to UTC on an invalid zone. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(date);
    return Number(h) % 24;
  } catch {
    return date.getUTCHours();
  }
}

/** 432 → "7h 12m"; 45 → "45m"; 120 → "2h". */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

export function formatNumber(value: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** "08:00" → "8:00 AM". */
export function formatClockTime(hhmm: string, locale = "en-US"): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}

/** Relative time against an explicit `now` so server and client render identically. */
export function formatRelative(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const future = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (mins < 1) return "just now";
  if (mins < 60) return wrap(`${mins} min`);
  const hours = Math.round(mins / 60);
  if (hours < 24) return wrap(`${hours} hour${hours === 1 ? "" : "s"}`);
  const days = Math.round(hours / 24);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  return wrap(`${days} days`);
}

export function formatAppointmentDate(iso: string, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

export function formatLongDate(date: Date, timeZone: string, locale = "en-US"): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  }
}
