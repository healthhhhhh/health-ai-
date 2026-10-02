/**
 * Age bands and launch eligibility. Pure functions, unit-tested.
 *
 * Bands follow the brackets used by app-store age laws and Apple's Declared Age
 * Range (Texas; California AB 1043): under 13, 13–15, 16–17, adult (18+).
 * With `AGE_ENFORCEMENT=enforce` only accounts whose band is enabled (the US
 * launch: 13–15, 16–17 and adult) may use health features; see `eligibilityFor`.
 */

export const AGE_BANDS = ["under_13", "13_15", "16_17", "adult"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** The account's band: `unknown` until the API has assessed it. */
export type AccountAgeBand = AgeBand | "unknown";

export const AGE_STATUSES = ["unknown", "in_scope", "blocked_under_13", "blocked_out_of_scope", "review"] as const;
/**
 * `blocked_*` describes where the band falls relative to the enabled bands
 * (enforced only with `AGE_ENFORCEMENT=enforce`). `review`: a blocked account
 * later claimed an older band (see `decide`); a person has to resolve it.
 */
export type AgeStatus = (typeof AGE_STATUSES)[number];

/**
 * Where an assessment came from. The API accepts only `self_declared` from people;
 * `birthday` is written by the API when a teen's recorded date of turning 18 moves
 * them into the next band (`effectiveAge`).
 */
export const AGE_SOURCES = ["self_declared", "apple_declared_age_range", "app_store_signal", "support", "parent_declared", "birthday"] as const;
export type AgeSource = (typeof AGE_SOURCES)[number];

/** `off`: nothing recorded. `record`: assessments recorded, nothing restricted. `enforce`: eligibility enforced. */
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

/** Bands served by the product's minors' features. Under 13 is never one of them (no parental consent). */
export const MINOR_BANDS: readonly AgeBand[] = ["13_15", "16_17"];

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The same month and day `years` later (29 February becomes 1 March in years without one). */
function shiftYears(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const year = y + years;
  if (m === 2 && d === 29 && !isLeapYear(year)) return `${pad(year, 4)}-03-01`;
  return `${pad(year, 4)}-${pad(m)}-${pad(d)}`;
}

/**
 * The first date on which someone born on `birthDay` is 18 (`completedYears`
 * rule). Kept for 13–17-year-olds only, so their band can follow their
 * birthdays without asking for their age again. It carries the same
 * information as the date of birth, so it is never sent to AI or logged.
 */
export function adultOnFor(birthDay: string): string {
  return shiftYears(birthDay, 18);
}

/**
 * The band on `today` for someone who turns 18 on `adultOn`. Their 16th and 13th
 * birthdays are 2 and 5 years earlier; `adultOn` is never 29 February (18 years
 * after a leap year isn't one), so the shift is exact except for people born on
 * 29 February, whose 16th birthday can be counted a day late — never early.
 */
export function bandOnDay(adultOn: string, today: string): AgeBand {
  if (today >= adultOn) return "adult";
  if (today >= shiftYears(adultOn, -2)) return "16_17";
  if (today >= shiftYears(adultOn, -5)) return "13_15";
  return "under_13";
}

/** The band for a date of birth plus, for 13–17-year-olds, the date they turn 18 — or why it can't be used. */
export function assessBirthDateFully(birthDay: string, now: Date = new Date()): { band: AgeBand; adultOn: string | null } | { problem: BirthDateProblem } {
  const result = assessBirthDate(birthDay, now);
  if ("problem" in result) return result;
  return { band: result.band, adultOn: MINOR_BANDS.includes(result.band) ? adultOnFor(birthDay) : null };
}

/** An account's recorded age state. */
export interface AgeRecord {
  band: AccountAgeBand;
  status: AgeStatus;
  /** The date a 13–17-year-old turns 18; null otherwise. */
  adultOn: string | null;
}

/**
 * The account's age state on `today` (`referenceDay`): a teen whose birthday has
 * moved them into the next band is in that band now. Only teens move this way —
 * an under-13 block, an account under review and an unknown age never change
 * by themselves.
 */
export function effectiveAge(record: AgeRecord, today: string, enabledBands: readonly AgeBand[]): AgeRecord {
  if (!record.adultOn || !(record.status === "in_scope" || record.status === "blocked_out_of_scope") || !MINOR_BANDS.includes(record.band as AgeBand)) return record;
  const band = bandOnDay(record.adultOn, today);
  // Never younger than recorded (only possible after a correction to an older adultOn).
  if (RANK[band] <= RANK[record.band as AgeBand]) return record;
  return { band, status: statusFor(band, enabledBands), adultOn: band === "adult" ? null : record.adultOn };
}

/**
 * Policy for a new assessment against the account's current (effective) state:
 * - no band on record: the assessment is applied;
 * - the same or a younger band: applied (the stricter answer always wins, and a
 *   consistent re-assessment clears an earlier `review`). Within the same band the
 *   later date of turning 18 is kept, so a re-entered date can't bring it forward;
 * - an older band than the one on record (an inconsistent claim): not applied —
 *   no assessment upgrades a band by itself. The outcome is `review`. An account
 *   that can use HealthMate keeps its younger band and status (it stays served
 *   under the stricter band); a blocked account becomes `review` and stays
 *   restricted until a person resolves it, so a different answer after a block
 *   doesn't unlock anything.
 */
export function decide(
  current: AgeRecord,
  assessed: { band: AgeBand; adultOn: string | null },
  enabledBands: readonly AgeBand[],
): AgeRecord & { band: AgeBand; outcome: "applied" | "review" } {
  if (current.band === "unknown" || RANK[assessed.band] <= RANK[current.band]) {
    const sameBand = assessed.band === current.band;
    const adultOn = sameBand && current.adultOn && assessed.adultOn && current.adultOn > assessed.adultOn ? current.adultOn : assessed.adultOn;
    return { band: assessed.band, status: statusFor(assessed.band, enabledBands), adultOn, outcome: "applied" };
  }
  if (current.status === "in_scope") return { band: current.band, status: current.status, adultOn: current.adultOn, outcome: "review" };
  return { band: current.band, status: "review", adultOn: current.adultOn, outcome: "review" };
}

/**
 * Whether the account may use health features under `AGE_ENFORCEMENT=enforce`.
 * Only `in_scope` is eligible; an unknown age must be given first, `review` waits
 * for a person, and blocked bands (under 13, or a band not enabled) aren't served.
 */
export type AgeEligibility = "eligible" | "age_required" | "age_review" | "age_not_eligible";

export function eligibilityFor(status: AgeStatus): AgeEligibility {
  switch (status) {
    case "in_scope":
      return "eligible";
    case "unknown":
      return "age_required";
    case "review":
      return "age_review";
    default:
      return "age_not_eligible";
  }
}
