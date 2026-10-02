import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../../common/audit";
import { ApiError, notFound, type ErrorCode } from "../../common/errors";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { stopQueuedAnalyses } from "./account.service";
import {
  assessBirthDateFully,
  decide,
  effectiveAge,
  eligibilityFor,
  referenceDay,
  statusFor,
  type AccountAgeBand,
  type AgeBand,
  type AgeEligibility,
  type AgeRecord,
  type AgeSource,
  type AgeStatus,
  type BirthDateProblem,
} from "./age";

export interface AgeState {
  ageBand: AccountAgeBand;
  ageStatus: AgeStatus;
  assessedAt: string | null;
  /** What the server enforces now: always `eligible` unless AGE_ENFORCEMENT=enforce. */
  eligibility: AgeEligibility;
  /** Set when the account was found to belong to someone under 13 (enforcement only). */
  deletionScheduledAt: string | null;
}

export interface AgeAssessmentResult extends AgeState {
  /** applied: the band on the account; review: it claimed an older band than the one on record (see `decide`). */
  outcome: "applied" | "review";
}

/** A 13–17-year-old's assessment carries the date they turn 18 (`adultOnFor`). */
export interface Assessed {
  band: AgeBand;
  adultOn: string | null;
}

const PROBLEM_MESSAGE: Record<BirthDateProblem, string> = {
  invalid: "Enter a real date of birth as YYYY-MM-DD.",
  future: "A date of birth can't be in the future.",
  implausible: "Check the date of birth — it's too far in the past.",
};

/** Refusals for accounts that can't use health features yet (or at all). Never mention a band or date. */
const REFUSAL: Record<Exclude<AgeEligibility, "eligible">, { code: ErrorCode; message: string }> = {
  age_required: { code: "age_required", message: "Add your date of birth to continue." },
  age_review: { code: "age_review", message: "We need to check your age before you can continue. Please contact support." },
  age_not_eligible: { code: "age_not_eligible", message: "HealthMate isn't available for your age." },
};

export const ageRefusal = (eligibility: Exclude<AgeEligibility, "eligible">) => new ApiError(REFUSAL[eligibility].code, REFUSAL[eligibility].message, HttpStatus.FORBIDDEN);

type UserAgeRow = { age_band: AccountAgeBand; age_status: AgeStatus; age_adult_on: string | null; age_assessed_at: Date | null; age_deletion_due_at: Date | null };
const AGE_COLUMNS = `age_band, age_status, age_adult_on::text AS age_adult_on, age_assessed_at, age_deletion_due_at`;
const recordOf = (row: UserAgeRow): AgeRecord => ({ band: row.age_band, status: row.age_status, adultOn: row.age_adult_on });

/**
 * Age assessment and launch eligibility. The band is always computed here from a
 * validated date of birth — a client never supplies a band or status — and the
 * date of birth itself isn't stored by this feature (for 13–17-year-olds only,
 * the date they turn 18, so their band follows their birthdays).
 *
 * With `AGE_ENFORCEMENT=enforce` only `in_scope` accounts may use health
 * features (`eligibility`, checked by AuthGuard on every route and by
 * ProcessingPolicy when work runs). An account found to belong to someone under
 * 13 is restricted at once, its queued analyses are stopped, and it is deleted
 * after UNDER_13_DELETION_HOURS.
 */
@Injectable()
export class AgeService {
  private readonly logger = new Logger("Age");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get recording(): boolean {
    return this.config.AGE_ENFORCEMENT !== "off";
  }

  get enforcing(): boolean {
    return this.config.AGE_ENFORCEMENT === "enforce";
  }

  /** The assessment for a date of birth, or a validation error (400) that never echoes the date. */
  assess(dateOfBirth: string): Assessed {
    const result = assessBirthDateFully(dateOfBirth);
    if ("problem" in result) throw new ApiError("validation_failed", PROBLEM_MESSAGE[result.problem], HttpStatus.BAD_REQUEST);
    return result;
  }

  /**
   * Sign-up and first Google sign-in with an age screen: when enforcing, a band
   * that isn't served is refused before any account exists, so nothing about the
   * person is kept. (Clients should also stop an immediate retry with another date.)
   */
  assertCanSignUp(assessed: Assessed): void {
    if (this.enforcing && statusFor(assessed.band, this.config.enabledAgeBands) !== "in_scope") throw ageRefusal("age_not_eligible");
  }

  /** The account's current age state; applies a birthday that moved a teen into the next band. */
  async state(userId: string): Promise<AgeState> {
    const row = await this.current(userId);
    return this.toState(row);
  }

  /** Whether the account may use health features now (always `eligible` unless enforcing). */
  async eligibility(userId: string): Promise<AgeEligibility> {
    if (!this.enforcing) return "eligible";
    return eligibilityFor((await this.current(userId)).age_status);
  }

  /** Throws the matching 403 unless the account may use health features. */
  async assertEligible(userId: string): Promise<void> {
    const eligibility = await this.eligibility(userId);
    if (eligibility !== "eligible") throw ageRefusal(eligibility);
  }

  /** `POST /v1/me/age`: a self-declared date of birth. */
  async assessDateOfBirth(userId: string, dateOfBirth: string): Promise<AgeAssessmentResult> {
    if (!this.recording) throw new ApiError("not_available", "Age assessment is turned off on this server.", HttpStatus.NOT_IMPLEMENTED);
    return this.record(userId, this.assess(dateOfBirth), "self_declared");
  }

  /**
   * Adds the assessment to the history and updates the account's current age
   * state in one transaction, with the account row locked so concurrent
   * assessments apply one after the other.
   */
  async record(userId: string, assessed: Assessed, source: AgeSource): Promise<AgeAssessmentResult> {
    const { row, outcome, underThirteen } = await this.db.transaction(async (tx) => {
      const locked = await this.lockedRecord(tx, userId);
      const next = decide(effectiveAge(recordOf(locked), referenceDay(), this.config.enabledAgeBands), assessed, this.config.enabledAgeBands);
      await tx.query(`INSERT INTO age_assessments (user_id, band, source, outcome) VALUES ($1, $2, $3, $4)`, [userId, assessed.band, source, next.outcome]);
      // Someone under 13: restricted from now on, deleted after the grace period. Never
      // rescheduled (a later, older answer doesn't move the deadline).
      const underThirteen = this.enforcing && next.band === "under_13";
      const updated = await tx.query<UserAgeRow>(
        `UPDATE users SET age_band = $2, age_status = $3, age_adult_on = $4::date, age_assessed_at = now(),
                age_deletion_due_at = CASE WHEN $5::boolean THEN COALESCE(age_deletion_due_at, now() + make_interval(hours => $6)) ELSE age_deletion_due_at END
          WHERE id = $1 RETURNING ${AGE_COLUMNS}`,
        [userId, next.band, next.status, next.adultOn, underThirteen, this.config.UNDER_13_DELETION_HOURS],
      );
      if (underThirteen) await stopQueuedAnalyses(tx, userId);
      return { row: updated.rows[0]!, outcome: next.outcome, underThirteen };
    });
    // Source and outcome only — no band or date in the audit trail.
    await this.audit.log("account.age_assessed", userId, { source, outcome, ...(underThirteen ? { restricted: true } : {}) });
    return { ...this.toState(row), outcome };
  }

  /**
   * The optional age screen sent with sign-up or Google sign-in, recorded after the
   * account exists. If recording fails the account simply stays `unknown` (the same
   * state as a client that sent no screen, and restricted when enforcing); sign-in
   * isn't failed because of it, and no partial history is left (`record` is one transaction).
   */
  async recordScreen(userId: string, assessed: Assessed): Promise<boolean> {
    try {
      await this.record(userId, assessed, "self_declared");
      return true;
    } catch (error) {
      this.logger.warn(`couldn't record the sign-up age screen (${error instanceof Error ? error.name : "error"})`);
      return false;
    }
  }

  /**
   * Maintenance, when enforcing: schedules deletion of under-13 accounts recorded
   * before enforcement was turned on. Returns how many were scheduled.
   */
  async scheduleUnderThirteenDeletions(): Promise<number> {
    if (!this.enforcing) return 0;
    const { rows } = await this.db.query(
      `UPDATE users SET age_deletion_due_at = now() + make_interval(hours => $1) WHERE age_band = 'under_13' AND age_deletion_due_at IS NULL RETURNING id`,
      [this.config.UNDER_13_DELETION_HOURS],
    );
    return rows.length;
  }

  private toState(row: UserAgeRow): AgeState {
    return {
      ageBand: row.age_band,
      ageStatus: row.age_status,
      assessedAt: row.age_assessed_at?.toISOString() ?? null,
      eligibility: this.enforcing ? eligibilityFor(row.age_status) : "eligible",
      deletionScheduledAt: row.age_deletion_due_at?.toISOString() ?? null,
    };
  }

  private async lockedRecord(tx: Queryable, userId: string): Promise<UserAgeRow> {
    const { rows } = await tx.query<UserAgeRow>(`SELECT ${AGE_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (!rows[0]) throw notFound("Account");
    return rows[0];
  }

  /**
   * The stored age state, after applying any birthday that moved a teen into the
   * next band (recorded in the history with source `birthday`).
   */
  private async current(userId: string): Promise<UserAgeRow> {
    const { rows } = await this.db.query<UserAgeRow>(`SELECT ${AGE_COLUMNS} FROM users WHERE id = $1`, [userId]);
    const row = rows[0];
    if (!row) throw notFound("Account");
    const today = referenceDay();
    const effective = effectiveAge(recordOf(row), today, this.config.enabledAgeBands);
    if (effective.band === row.age_band) return row;
    return this.db.transaction(async (tx) => {
      const locked = await this.lockedRecord(tx, userId);
      const next = effectiveAge(recordOf(locked), today, this.config.enabledAgeBands);
      if (next.band === locked.age_band) return locked;
      await tx.query(`INSERT INTO age_assessments (user_id, band, source, outcome) VALUES ($1, $2, 'birthday', 'applied')`, [userId, next.band]);
      const updated = await tx.query<UserAgeRow>(
        `UPDATE users SET age_band = $2, age_status = $3, age_adult_on = $4::date WHERE id = $1 RETURNING ${AGE_COLUMNS}`,
        [userId, next.band, next.status, next.adultOn],
      );
      return updated.rows[0]!;
    });
  }
}
