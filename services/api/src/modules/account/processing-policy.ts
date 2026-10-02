import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ApiError, type ErrorCode } from "../../common/errors";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { effectiveAge, eligibilityFor, referenceDay, type AccountAgeBand, type AgeEligibility, type AgeStatus } from "./age";

/** What a person can grant or withdraw (append-only history in `consents`). */
export type ConsentKind = "ai_processing" | "document_processing" | "health_data_sync" | "voice";

/**
 * Server-side processing that needs the person's current consent. Each purpose
 * is the consent kind that covers it. Purposes are derived on the server from
 * the work being done (e.g. `TASK_PURPOSE` for AI tasks) — never taken from a
 * request body. (`voice` is handled on the device and has no server purpose.)
 */
export type ProcessingPurpose = Exclude<ConsentKind, "voice">;

export const CONSENT_REQUIRED_MESSAGE = "Please review and accept how HealthMate processes this data before continuing.";

const AGE_MESSAGE: Record<Exclude<AgeEligibility, "eligible">, string> = {
  age_required: "Add your date of birth to continue.",
  age_review: "We need to check your age before you can continue. Please contact support.",
  age_not_eligible: "HealthMate isn't available for your age.",
};

/**
 * The person's current consent (or, when enforcing, their age eligibility) doesn't
 * cover this processing. Maps to 403 like `requireConsent` / the age gate.
 */
export class ProcessingNotPermittedError extends ApiError {
  constructor(
    readonly purpose: ProcessingPurpose,
    readonly reason: "consent" | Exclude<AgeEligibility, "eligible"> = "consent",
  ) {
    super(reason === "consent" ? "forbidden" : (reason as ErrorCode), reason === "consent" ? CONSENT_REQUIRED_MESSAGE : AGE_MESSAGE[reason], HttpStatus.FORBIDDEN);
    this.name = "ProcessingNotPermittedError";
  }
}

/** One lock per person and consent kind, shared by every change and every check that must not interleave with one. */
const lockKey = (userId: string, kind: ConsentKind) => `healthmate.consent:${userId}:${kind}`;

/**
 * The single place that decides whether processing may run now, from the
 * person's latest consent row. Called when a request arrives (controllers, via
 * `AccountService.requireConsent`) and again when work executes (AI gateway,
 * background jobs, health sync), so withdrawing consent also stops work that
 * was queued earlier.
 *
 * Races: a consent change takes an exclusive transaction-scoped advisory lock
 * on (person, kind); a write that must not happen after a withdrawal takes the
 * shared lock in its own transaction and re-checks (`assertLocked`). Either the
 * write commits first (then the withdrawal sees and handles its result) or the
 * withdrawal commits first (then the write sees it and is refused).
 *
 * Age: with AGE_ENFORCEMENT=enforce, processing also needs an eligible age state
 * (`eligibilityFor`), checked at the same moments — so a job queued before an
 * account was restricted (e.g. found to be under 13) doesn't run afterwards.
 *
 * Limit: once a request has been handed to an AI provider it can't be recalled.
 * A withdrawal during that window stops the result from being stored, not the
 * provider from receiving the request.
 */
@Injectable()
export class ProcessingPolicy {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    // Optional so unit tests can build a policy from a database alone (no age gate).
    @Optional() @Inject(CONFIG) private readonly config?: Pick<AppConfig, "AGE_ENFORCEMENT" | "enabledAgeBands">,
  ) {}

  /** The latest consent for this kind is a grant (no record means not granted), and the age gate allows processing. */
  async permitted(userId: string, kind: ConsentKind, tx: Queryable = this.db): Promise<boolean> {
    return (await this.refusal(userId, kind, tx)) === null;
  }

  async assert(userId: string, purpose: ProcessingPurpose, tx: Queryable = this.db): Promise<void> {
    const reason = await this.refusal(userId, purpose, tx);
    if (reason) throw new ProcessingNotPermittedError(purpose, reason);
  }

  private async refusal(userId: string, kind: ConsentKind, tx: Queryable): Promise<ProcessingNotPermittedError["reason"] | null> {
    const enforcing = this.config?.AGE_ENFORCEMENT === "enforce";
    const { rows } = await tx.query<{ granted: boolean | null; age_band: AccountAgeBand; age_status: AgeStatus; age_adult_on: string | null }>(
      `SELECT (SELECT granted FROM consents WHERE user_id = u.id AND kind = $2 ORDER BY created_at DESC LIMIT 1) AS granted,
              u.age_band, u.age_status, u.age_adult_on::text AS age_adult_on
         FROM users u WHERE u.id = $1`,
      [userId, kind],
    );
    const row = rows[0];
    if (!row) return "consent";
    if (enforcing) {
      // The stored state plus any birthday since (AgeService records it on the next request).
      const { status } = effectiveAge({ band: row.age_band, status: row.age_status, adultOn: row.age_adult_on }, referenceDay(), this.config!.enabledAgeBands);
      const eligibility = eligibilityFor(status);
      if (eligibility !== "eligible") return eligibility;
    }
    return row.granted ? null : "consent";
  }

  /**
   * Inside a write transaction: waits for any consent change in progress for
   * this purpose, then checks. Use where storing data after a withdrawal must
   * be impossible.
   */
  async assertLocked(tx: Queryable, userId: string, purpose: ProcessingPurpose): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))`, [lockKey(userId, purpose)]);
    await this.assert(userId, purpose, tx);
  }

  /** Inside the transaction that records a consent change: excludes concurrent `assertLocked` writers. */
  static async lockForChange(tx: Queryable, userId: string, kind: ConsentKind): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey(userId, kind)]);
  }
}
