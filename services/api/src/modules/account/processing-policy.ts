import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";

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

/** The person's current consent doesn't cover this processing. Maps to 403 like `requireConsent`. */
export class ProcessingNotPermittedError extends ApiError {
  constructor(readonly purpose: ProcessingPurpose) {
    super("forbidden", CONSENT_REQUIRED_MESSAGE, HttpStatus.FORBIDDEN);
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
 * Limit: once a request has been handed to an AI provider it can't be recalled.
 * A withdrawal during that window stops the result from being stored, not the
 * provider from receiving the request.
 */
@Injectable()
export class ProcessingPolicy {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The latest consent for this kind; no record means not granted. */
  async permitted(userId: string, kind: ConsentKind, tx: Queryable = this.db): Promise<boolean> {
    const { rows } = await tx.query<{ granted: boolean }>(`SELECT granted FROM consents WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`, [userId, kind]);
    return rows[0]?.granted ?? false;
  }

  async assert(userId: string, purpose: ProcessingPurpose, tx: Queryable = this.db): Promise<void> {
    if (!(await this.permitted(userId, purpose, tx))) throw new ProcessingNotPermittedError(purpose);
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
