import type { Database, Queryable } from "../../db/database";

/** One `ai_usage` row (operational: ids, counts and amounts only — never content). */
export interface UsageRow {
  userId: string | null;
  task: string;
  provider: string;
  /** The model that answered (or was going to). */
  model: string;
  /** The model the route asked for. */
  requestedModel: string;
  billingPeriod: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  costUsd: number;
  /** usage: priced from reported tokens; reservation: usage unknown, charged the reserved worst case; none: nothing charged. */
  costBasis: "usage" | "reservation" | "none";
  status: string;
  safetyCritical: boolean;
  validationIssueCount: number;
  priceVersion: string;
}

export interface ReservationRequest {
  userId: string;
  billingPeriod: string;
  task: string;
  provider: string;
  model: string;
  /** Worst-case cost of the request (USD). */
  amountUsd: number;
  /** null: no limit (safety-critical requests, or the limit is off) — still accounted. */
  limitUsd: number | null;
  safetyCritical: boolean;
  /** After this, a reservation still held (crashed process) is charged in full. */
  ttlMs: number;
}

const usd = (n: number) => n.toFixed(6);

const INSERT_USAGE = `INSERT INTO ai_usage (user_id, feature, task, provider, model, requested_model, billing_period, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                        estimated_cost_usd, cost_usd, cost_basis, outcome, status, safety_critical, validation_issue_count, price_version, reservation_id)
                      VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12::numeric, $13, $14, $14, $15, $16, $17, $18)`;
const usageParams = (row: UsageRow, reservationId: string | null) => [
  row.userId,
  row.task,
  row.provider,
  row.model,
  row.requestedModel,
  row.billingPeriod,
  row.inputTokens,
  row.outputTokens,
  row.cacheReadTokens,
  row.cacheWriteTokens,
  usd(row.estimatedCostUsd),
  usd(row.costUsd),
  row.costBasis,
  row.status,
  row.safetyCritical,
  row.validationIssueCount,
  row.priceVersion,
  reservationId,
];

/**
 * The monthly AI cost ledger (`ai_budget_periods` + `ai_budget_reservations`).
 *
 * - `reserve` adds a request's worst-case cost to the person's reserved total
 *   in one conditional UPDATE. Postgres row-locks the ledger row and
 *   re-checks the condition, so concurrent requests serialize there and
 *   can never jointly pass the limit.
 * - `settle` replaces the reservation with what the request really cost (and
 *   writes its usage row in the same transaction). It only acts on a held
 *   reservation, so settling twice — a retry — charges once.
 * - `expireStale` charges reservations left held by a crashed process in full
 *   (the request may have been billed), so nothing stays reserved forever.
 */
export class AiBudgetLedger {
  constructor(private readonly db: Database) {}

  /** The reservation id, or null when the request would pass the limit. */
  async reserve(request: ReservationRequest): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await this.expireStale(request.userId, tx);
      await tx.query(`INSERT INTO ai_budget_periods (user_id, billing_period) VALUES ($1, $2) ON CONFLICT (user_id, billing_period) DO NOTHING`, [request.userId, request.billingPeriod]);
      const { rows } = await tx.query(
        `UPDATE ai_budget_periods SET reserved_usd = reserved_usd + $3::numeric, updated_at = now()
          WHERE user_id = $1 AND billing_period = $2 AND ($4::numeric IS NULL OR spent_usd + reserved_usd + $3::numeric <= $4::numeric)
          RETURNING 1`,
        [request.userId, request.billingPeriod, usd(request.amountUsd), request.limitUsd === null ? null : usd(request.limitUsd)],
      );
      if (!rows[0]) return null;
      const reservation = await tx.query<{ id: string }>(
        `INSERT INTO ai_budget_reservations (user_id, billing_period, task, provider, model, amount_usd, safety_critical, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, now() + make_interval(secs => $8)) RETURNING id`,
        [request.userId, request.billingPeriod, request.task, request.provider, request.model, usd(request.amountUsd), request.safetyCritical, request.ttlMs / 1000],
      );
      return reservation.rows[0]!.id;
    });
  }

  /**
   * Finalises a reservation at `row.costUsd` and records its usage row, in one
   * transaction, with the reservation row locked.
   *
   * - held: settled (or released) at the real cost; returns "settled".
   * - charged at the reservation because usage was unknown (it expired, or
   *   its call timed out) and not yet reconciled: when the real usage arrives
   *   late, the charge is raised to the real cost if that is higher — never
   *   lowered — and the reservation is marked reconciled; returns "reconciled".
   * - anything else (already settled, released or reconciled): nothing changes;
   *   returns null. Retries and late duplicates can't charge twice.
   */
  async settle(reservationId: string, row: UsageRow, status: "settled" | "released" = "settled"): Promise<"settled" | "reconciled" | null> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: string; billing_period: string; amount_usd: string; charged_usd: string | null; status: string; reconciled_at: Date | null; basis: string | null }>(
        `SELECT r.user_id, r.billing_period, r.amount_usd, r.charged_usd, r.status, r.reconciled_at,
                (SELECT u.cost_basis FROM ai_usage u WHERE u.reservation_id = r.id) AS basis
           FROM ai_budget_reservations r WHERE r.id = $1 FOR UPDATE OF r`,
        [reservationId],
      );
      const reservation = rows[0];
      if (!reservation) return null;
      if (reservation.status === "held") {
        await tx.query(`UPDATE ai_budget_reservations SET status = $2, charged_usd = $3::numeric, settled_at = now() WHERE id = $1`, [reservationId, status, usd(row.costUsd)]);
        await tx.query(
          `UPDATE ai_budget_periods SET reserved_usd = GREATEST(reserved_usd - $3::numeric, 0), spent_usd = spent_usd + $4::numeric, updated_at = now() WHERE user_id = $1 AND billing_period = $2`,
          [reservation.user_id, reservation.billing_period, reservation.amount_usd, usd(row.costUsd)],
        );
        await tx.query(INSERT_USAGE, usageParams({ ...row, billingPeriod: reservation.billing_period }, reservationId));
        return "settled";
      }
      if ((reservation.status === "expired" || reservation.status === "settled") && reservation.basis === "reservation" && !reservation.reconciled_at) {
        const charged = Number(reservation.charged_usd ?? reservation.amount_usd);
        const extra = Math.max(0, Math.round((row.costUsd - charged) * 1_000_000) / 1_000_000);
        await tx.query(`UPDATE ai_budget_reservations SET reconciled_at = now(), charged_usd = charged_usd + $2::numeric WHERE id = $1`, [reservationId, usd(extra)]);
        if (extra > 0) {
          await tx.query(`UPDATE ai_budget_periods SET spent_usd = spent_usd + $3::numeric, updated_at = now() WHERE user_id = $1 AND billing_period = $2`, [reservation.user_id, reservation.billing_period, usd(extra)]);
        }
        // The usage row now carries the request's real usage; its cost never goes down.
        await tx.query(
          `UPDATE ai_usage SET model = $2, input_tokens = $3, output_tokens = $4, cache_read_tokens = $5, cache_write_tokens = $6, cost_usd = cost_usd + $7::numeric,
                  cost_basis = CASE WHEN $7::numeric > 0 THEN $8 ELSE cost_basis END
            WHERE reservation_id = $1`,
          [reservationId, row.model, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, usd(extra), row.costBasis],
        );
        return "reconciled";
      }
      return null;
    });
  }

  /** Records usage that had no reservation (free providers, system work, refused requests). */
  async record(row: UsageRow, tx: Queryable = this.db) {
    await tx.query(INSERT_USAGE, usageParams(row, null));
  }

  /** Charges reservations held past their expiry in full; returns how many. All people when userId is null. */
  async expireStale(userId: string | null = null, tx: Queryable = this.db): Promise<number> {
    const { rows } = await tx.query<{ n: number }>(
      `WITH expired AS (
         UPDATE ai_budget_reservations SET status = 'expired', charged_usd = amount_usd, settled_at = now()
          WHERE status = 'held' AND expires_at < now() AND ($1::uuid IS NULL OR user_id = $1::uuid)
          RETURNING id, user_id, billing_period, task, provider, model, amount_usd, safety_critical
       ), moved AS (
         UPDATE ai_budget_periods p SET reserved_usd = GREATEST(p.reserved_usd - e.total, 0), spent_usd = p.spent_usd + e.total, updated_at = now()
           FROM (SELECT user_id, billing_period, SUM(amount_usd) AS total FROM expired GROUP BY user_id, billing_period) e
          WHERE p.user_id = e.user_id AND p.billing_period = e.billing_period
          RETURNING 1
       ), recorded AS (
         INSERT INTO ai_usage (user_id, feature, task, provider, model, requested_model, billing_period, input_tokens, output_tokens,
                               estimated_cost_usd, cost_usd, cost_basis, outcome, status, safety_critical, reservation_id)
         SELECT user_id, task, task, provider, model, model, billing_period, 0, 0, amount_usd, amount_usd, 'reservation', 'expired', 'expired', safety_critical, id FROM expired
         ON CONFLICT (reservation_id) DO NOTHING
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM expired)::int AS n`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Settled spend and in-flight reservations for a person's period (USD). Internal only. */
  async balance(userId: string, billingPeriod: string): Promise<{ spent: number; reserved: number }> {
    const { rows } = await this.db.query<{ spent_usd: string; reserved_usd: string }>(`SELECT spent_usd, reserved_usd FROM ai_budget_periods WHERE user_id = $1 AND billing_period = $2`, [userId, billingPeriod]);
    return { spent: Number(rows[0]?.spent_usd ?? 0), reserved: Number(rows[0]?.reserved_usd ?? 0) };
  }
}
