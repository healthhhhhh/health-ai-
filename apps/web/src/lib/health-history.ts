import type { MeasurementKind, TrendResponse } from "@healthmate/shared-types";

/** Metrics shown in the daily health history, in display order. */
export const HISTORY_METRICS: MeasurementKind[] = ["sleep", "steps", "resting_heart_rate", "heart_rate", "active_energy", "weight"];

/** One day of the person's health history: each metric's value that day (missing when not recorded). */
export interface DaySummary {
  date: string; // YYYY-MM-DD
  values: Partial<Record<MeasurementKind, number>>;
}

/**
 * Turns per-metric daily trends into one row per day, newest first. Every day
 * that has any reading appears; this is the person's longitudinal record.
 */
export function buildDailyHistory(trends: Partial<Record<MeasurementKind, TrendResponse | null>>): DaySummary[] {
  const days = new Map<string, DaySummary>();
  for (const kind of HISTORY_METRICS) {
    for (const point of trends[kind]?.points ?? []) {
      const day = days.get(point.date) ?? { date: point.date, values: {} };
      day.values[kind] = point.value;
      days.set(point.date, day);
    }
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export type UsualComparison = "in_usual_range" | "above_usual" | "below_usual" | "no_baseline";

/**
 * A day's value against the person's own average for the days before it
 * (within 10% = their usual range). Needs at least 5 earlier readings.
 */
export function compareWithUsual(history: DaySummary[], date: string, kind: MeasurementKind, window = 30): { usual: number | null; comparison: UsualComparison } {
  const value = history.find((d) => d.date === date)?.values[kind];
  const earlier = history
    .filter((d) => d.date < date && d.values[kind] !== undefined)
    .slice(0, window)
    .map((d) => d.values[kind]!);
  if (value === undefined || earlier.length < 5) return { usual: null, comparison: "no_baseline" };
  const usual = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const change = (value - usual) / usual;
  return { usual, comparison: Math.abs(change) <= 0.1 ? "in_usual_range" : change > 0 ? "above_usual" : "below_usual" };
}

/** Groups days by month ("September 2026"), keeping order. */
export function groupByMonth(days: DaySummary[]): { month: string; days: DaySummary[] }[] {
  const groups: { month: string; days: DaySummary[] }[] = [];
  for (const day of days) {
    const month = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const last = groups.at(-1);
    if (last?.month === month) last.days.push(day);
    else groups.push({ month, days: [day] });
  }
  return groups;
}

/** "Today", "Yesterday" or "Mon, Sep 28" for a history day. */
export function dayLabel(date: string, today?: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  if (today && new Date(`${today}T12:00:00Z`).getTime() - d.getTime() === 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The day before / after, as "YYYY-MM-DD". */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
