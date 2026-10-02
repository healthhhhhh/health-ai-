import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../../common/audit";
import { ApiError, notFound } from "../../common/errors";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database } from "../../db/database";
import { assessBirthDate, decide, type AccountAgeBand, type AgeBand, type AgeSource, type AgeStatus, type BirthDateProblem } from "./age";

export interface AgeState {
  ageBand: AccountAgeBand;
  ageStatus: AgeStatus;
  assessedAt: string | null;
}

export interface AgeAssessmentResult extends AgeState {
  /** applied: the band on the account; review: it conflicted with a younger band on record (see `decide`). */
  outcome: "applied" | "review";
}

const PROBLEM_MESSAGE: Record<BirthDateProblem, string> = {
  invalid: "Enter a real date of birth as YYYY-MM-DD.",
  future: "A date of birth can't be in the future.",
  implausible: "Check the date of birth — it's too far in the past.",
};

/**
 * Records age assessments (age & consent Phase 2A). The band is always computed
 * here from a validated date of birth — a client never supplies a band or
 * status — and the date of birth itself isn't stored by this feature. Recording
 * only: nothing restricts or deletes anything by age in this phase.
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

  /** The band for a date of birth, or a validation error (400) that never echoes the date. */
  bandFor(dateOfBirth: string): AgeBand {
    const result = assessBirthDate(dateOfBirth);
    if ("problem" in result) throw new ApiError("validation_failed", PROBLEM_MESSAGE[result.problem], HttpStatus.BAD_REQUEST);
    return result.band;
  }

  async state(userId: string): Promise<AgeState> {
    const { rows } = await this.db.query<{ age_band: AccountAgeBand; age_status: AgeStatus; age_assessed_at: Date | null }>(
      `SELECT age_band, age_status, age_assessed_at FROM users WHERE id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) throw notFound("Account");
    return { ageBand: row.age_band, ageStatus: row.age_status, assessedAt: row.age_assessed_at?.toISOString() ?? null };
  }

  /** `POST /v1/me/age`: a self-declared date of birth. */
  async assessDateOfBirth(userId: string, dateOfBirth: string): Promise<AgeAssessmentResult> {
    if (!this.recording) throw new ApiError("not_available", "Age assessment is turned off on this server.", HttpStatus.NOT_IMPLEMENTED);
    return this.record(userId, this.bandFor(dateOfBirth), "self_declared");
  }

  /**
   * Adds the assessment to the history and updates the account's current age
   * state in one transaction, with the account row locked so concurrent
   * assessments apply one after the other.
   */
  async record(userId: string, band: AgeBand, source: AgeSource): Promise<AgeAssessmentResult> {
    const result = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ age_band: AccountAgeBand }>(`SELECT age_band FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const current = rows[0];
      if (!current) throw notFound("Account");
      const next = decide({ band: current.age_band }, band, this.config.enabledAgeBands);
      await tx.query(`INSERT INTO age_assessments (user_id, band, source, outcome) VALUES ($1, $2, $3, $4)`, [userId, band, source, next.outcome]);
      const updated = await tx.query<{ age_assessed_at: Date }>(
        `UPDATE users SET age_band = $2, age_status = $3, age_assessed_at = now() WHERE id = $1 RETURNING age_assessed_at`,
        [userId, next.band, next.status],
      );
      return { ageBand: next.band, ageStatus: next.status, assessedAt: updated.rows[0]!.age_assessed_at.toISOString(), outcome: next.outcome };
    });
    // Source and outcome only — no band or date in the audit trail.
    await this.audit.log("account.age_assessed", userId, { source, outcome: result.outcome });
    return result;
  }

  /**
   * The optional age screen sent with sign-up or Google sign-in, recorded after the
   * account exists. If recording fails the account simply stays `unknown` (the same
   * state as a client that sent no screen); sign-in isn't failed because of it, and
   * no partial history is left (`record` is one transaction).
   */
  async recordScreen(userId: string, band: AgeBand): Promise<boolean> {
    try {
      await this.record(userId, band, "self_declared");
      return true;
    } catch (error) {
      this.logger.warn(`couldn't record the sign-up age screen (${error instanceof Error ? error.name : "error"})`);
      return false;
    }
  }
}
