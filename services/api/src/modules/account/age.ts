/**
 * Age bands (age & consent Phase 2A). Pure functions, unit-tested.
 *
 * Bands follow the brackets used by app-store age laws and Apple's Declared Age
 * Range (Texas; California AB 1043): under 13, 13–15, 16–17, adult (18+).
 * Recording only: nothing in this phase restricts anyone by age.
 */

export const AGE_BANDS = ["under_13", "13_15", "16_17", "adult"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** The account's band: `unknown` until the API has assessed it. */
export type AccountAgeBand = AgeBand | "unknown";

export const AGE_STATUSES = ["unknown", "in_scope", "blocked_under_13", "blocked_out_of_scope", "review"] as const;
/**
 * `blocked_*` describes where the band falls relative to the enabled bands; in
 * this phase it is recorded, never enforced. `review`: a later assessment
 * claimed an older band than the one on record (see `decide`).
 */
export type AgeStatus = (typeof AGE_STATUSES)[number];

/** Where an assessment came from. Only `self_declared` is accepted by the API today. */
export const AGE_SOURCES = ["self_declared", "apple_declared_age_range", "app_store_signal", "support", "parent_declared"] as const;
export type AgeSource = (typeof AGE_SOURCES)[number];

export const AGE_ENFORCEMENT_MODES = ["off", "record", "enforce"] as const;
export type AgeEnforcement = (typeof AGE_ENFORCEMENT_MODES)[number];

const RANK: Record<AgeBand, number> = { under_13: 0, "13_15": 1, "16_17": 2, adult: 3 };
/** Older dates of birth are treated as typing mistakes rather than ages. */
export const MAX_AGE_YEARS = 130;

const HOUR = 3_600_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The date ages are counted on: today's date at UTC−12, the earliest calendar
 * date in effect anywhere. It doesn't depend on any setting a person controls
 * (such as their profile time zone), and it never counts someone as older than
 * they are wherever they live — at worst a birthday is recognised up to a day late.
 */
export function referenceDay(now: Date = new Date()): string {
  return new Date(now.getTime() - 12 * HOUR).toISOString().slice(0, 10);
}

/** The latest calendar date in effect anywhere (UTC+14): a birth date after it is in the future everywhere. */
export function latestDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * HOUR).toISOString().slice(0, 10);
}

/** A real calendar date in strict `YYYY-MM-DD` form (no times, no offsets, no 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Completed years on `onDay` (both `YYYY-MM-DD`). A birthday counts once its
 * month and day are reached, so someone born on 29 February turns a year older
 * on 1 March in years without a 29 February.
 */
export function completedYears(birthDay: string, onDay: string): number {
  const [by, bm, bd] = birthDay.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDay.split("-").map(Number) as [number, number, number];
  const beforeBirthday = m < bm || (m === bm && d < bd);
  return y - by - (beforeBirthday ? 1 : 0);
}

export function bandForAge(years: number): AgeBand {
  if (years < 13) return "under_13";
  if (years < 16) return "13_15";
  if (years < 18) return "16_17";
  return "adult";
}

export type BirthDateProblem = "invalid" | "future" | "implausible";

/** The band for a date of birth, computed on the server — or why it can't be used. */
export function assessBirthDate(birthDay: string, now: Date = new Date()): { band: AgeBand } | { problem: BirthDateProblem } {
  if (!isCalendarDay(birthDay)) return { problem: "invalid" };
  if (birthDay > latestDay(now)) return { problem: "future" };
  const today = referenceDay(now);
  // Born "today" somewhere east of UTC−12: age 0.
  const years = birthDay > today ? 0 : completedYears(birthDay, today);
  if (years > MAX_AGE_YEARS) return { problem: "implausible" };
  return { band: bandForAge(years) };
}

/** Where a band sits relative to the bands enabled by configuration. */
export function statusFor(band: AgeBand, enabledBands: readonly AgeBand[]): AgeStatus {
  if (enabledBands.includes(band)) return "in_scope";
  return band === "under_13" ? "blocked_under_13" : "blocked_out_of_scope";
}

/**
 * Review policy for a new assessment against the account's current state:
 * - no band on record: the assessment is applied;
 * - the same or a younger band: applied (the stricter answer always wins, and a
 *   consistent re-assessment clears an earlier `review`);
 * - an older band than the one on record: not applied. The recorded band stays,
 *   the status becomes `review`, and a person (support) must resolve it. Without a
 *   stored date of birth the API can't tell a genuine birthday from an edited
 *   date, so no assessment upgrades a band by itself in this phase.
 */
export function decide(
  current: { band: AccountAgeBand },
  assessed: AgeBand,
  enabledBands: readonly AgeBand[],
): { band: AgeBand; status: AgeStatus; outcome: "applied" | "review" } {
  if (current.band === "unknown" || RANK[assessed] <= RANK[current.band]) {
    return { band: assessed, status: statusFor(assessed, enabledBands), outcome: "applied" };
  }
  return { band: current.band, status: "review", outcome: "review" };
}
