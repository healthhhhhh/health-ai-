import type { MedicationRecord, PlanCompletionRecord, PlanItemRecord, PlanRecord, PlanTask } from "@healthmate/shared-types";

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

/** "HH:mm" for a date in a time zone. */
export function timeIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function shift(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface TaskOverview {
  /** Today, time has passed and not done yet. */
  dueEarlier: PlanTask[];
  laterToday: PlanTask[];
  doneToday: PlanTask[];
  /** The next days, each with its tasks (days with nothing are left out). */
  upcoming: { day: string; tasks: PlanTask[] }[];
  /** Earlier days in the last week that weren't done, newest first. */
  notDone: { day: string; task: PlanTask }[];
}

/** Everything in the plan across days. Mirrors PlanSchedule.overview (Swift). */
export function taskOverview(plan: Pick<PlanRecord, "items" | "completions">, today: string, now: string, days = 7): TaskOverview {
  const todays = tasksForDay(plan, today);
  const open = todays.filter((t) => !t.completed);
  return {
    dueEarlier: open.filter((t) => t.scheduledTime <= now),
    laterToday: open.filter((t) => t.scheduledTime > now),
    doneToday: todays.filter((t) => t.completed),
    upcoming: Array.from({ length: days - 1 }, (_, i) => shift(today, i + 1))
      .map((day) => ({ day, tasks: tasksForDay(plan, day) }))
      .filter((d) => d.tasks.length > 0),
    notDone: Array.from({ length: days - 1 }, (_, i) => shift(today, -(i + 1))).flatMap((day) =>
      tasksForDay(plan, day)
        .filter((t) => !t.completed)
        .map((task) => ({ day, task })),
    ),
  };
}

/** Done / scheduled over the last `days` days, not counting today if it's still due. */
export function adherence(plan: Pick<PlanRecord, "completions">, item: PlanItemRecord, today: string, days = 7) {
  const history = itemHistory(plan, item, today, days);
  const counted = history.filter((h) => h.status === "done" || h.status === "missed");
  return { history, done: counted.filter((h) => h.status === "done").length, scheduled: counted.length };
}

export interface UnifiedMedication {
  /** A stable key: the plan item's id, or "profile-<id>" for a profile-only medication. */
  key: string;
  name: string;
  /** Exactly as entered: the plan's instruction, else the profile's. */
  instruction: string | null;
  planItem: PlanItemRecord | null;
  profile: MedicationRecord | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One list of medications from the plan (with reminders) and the health profile,
 * matched by name. Instructions are never merged or rewritten — each is shown as entered.
 */
export function unifiedMedications(plan: Pick<PlanRecord, "items">, profileMedications: MedicationRecord[]): UnifiedMedication[] {
  const active = profileMedications.filter((m) => m.active);
  const fromPlan = plan.items
    .filter((i) => i.kind === "medication")
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((item) => {
      const profile = active.find((m) => sameName(m.name, item.title)) ?? null;
      return { key: item.id, name: item.title, instruction: item.instruction ?? profile?.instruction ?? null, planItem: item, profile };
    });
  const profileOnly = active
    .filter((m) => !fromPlan.some((u) => u.profile?.id === m.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({ key: `profile-${m.id}`, name: m.name, instruction: m.instruction, planItem: null, profile: m }));
  return [...fromPlan, ...profileOnly];
}
