import type { PlanCompletionRecord, PlanItemRecord, PlanRecord, PlanTask } from "@healthmate/shared-types";

/** Calendar weekday for a "YYYY-MM-DD" day: 1 = Sunday … 7 = Saturday (same as iOS). */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 1;
}

/** Whether an item is scheduled on a day. Mirrors PlanSchedule.occurs (Swift). */
export function occurs(item: PlanItemRecord, day: string): boolean {
  if (day < item.startDay) return false;
  if (item.endDay && day > item.endDay) return false;
  switch (item.repeat.type) {
    case "daily":
      return true;
    case "weekdays":
      return item.repeat.days.includes(weekday(day));
    case "once":
      return item.repeat.day === day;
  }
}

/** The day's plan as Home tasks, ordered by time then title. */
export function tasksForDay(plan: Pick<PlanRecord, "items" | "completions">, day: string): PlanTask[] {
  const done = new Set(plan.completions.filter((c) => c.day === day).map((c) => c.itemId));
  return plan.items
    .filter((item) => occurs(item, day))
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title))
    .map((item) => ({
      id: item.id,
      title: item.title,
      detail: (item.kind === "medication" ? item.instruction : item.notes) ?? undefined,
      category: item.kind === "medication" ? "medication" : item.kind === "habit" ? "activity" : "other",
      scheduledTime: item.time,
      completed: done.has(item.id),
      source: item.source,
    }));
}

/** Completions after marking an item done or not done on a day. Only today and earlier can be completed. */
export function withCompletion(completions: PlanCompletionRecord[], itemId: string, day: string, completed: boolean, today: string, now = new Date()): PlanCompletionRecord[] {
  if (completed && day > today) throw new Error("Future days can't be completed yet.");
  const rest = completions.filter((c) => !(c.itemId === itemId && c.day === day));
  return completed ? [...rest, { itemId, day, completedAt: now.toISOString() }] : rest;
}

/** "YYYY-MM-DD" for a date in a time zone. */
export function dayIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every day", "Mon, Wed, Fri", "Once on 2026-10-01". */
export function describeRepeat(repeat: PlanItemRecord["repeat"]): string {
  switch (repeat.type) {
    case "daily":
      return "Every day";
    case "weekdays": {
      const days = [...repeat.days].sort((a, b) => a - b);
      // 1 = Sunday … 7 = Saturday, as in `weekday`.
      if (days.join() === "2,3,4,5,6") return "Weekdays";
      if (days.join() === "1,7") return "Weekends";
      return days.map((d) => WEEKDAYS[d - 1]).join(", ");
    }
    case "once":
      return `Once, on ${new Date(`${repeat.day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }
}

export type HistoryStatus = "done" | "missed" | "due" | "not_scheduled";

/** The last `days` days (oldest first) for one item: done, missed, due today, or not scheduled. */
export function itemHistory(plan: Pick<PlanRecord, "completions">, item: PlanItemRecord, today: string, days = 7): { day: string; status: HistoryStatus }[] {
  const done = new Set(plan.completions.filter((c) => c.itemId === item.id).map((c) => c.day));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const day = d.toISOString().slice(0, 10);
    const status: HistoryStatus = !occurs(item, day) ? "not_scheduled" : done.has(day) ? "done" : day === today ? "due" : "missed";
    return { day, status };
  });
}
