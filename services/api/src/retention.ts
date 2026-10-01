import type { AppConfig } from "./config";
import type { Database } from "./db/database";

/**
 * Operational tables that may be pruned, with the setting that controls each.
 * Health data (records, memories, documents, conversations) is deliberately
 * absent: it is kept until the person deletes it.
 */
export const RETENTION = [
  { table: "audit_logs", setting: "AUDIT_LOG_RETENTION_DAYS" },
  { table: "ai_usage", setting: "AI_USAGE_RETENTION_DAYS" },
  { table: "ai_budget_reservations", setting: "AI_USAGE_RETENTION_DAYS" },
  { table: "safety_events", setting: "SAFETY_EVENT_RETENTION_DAYS" },
] as const;

/** Deletes operational records older than their retention period. Returns rows removed per table. */
export async function pruneOperationalRecords(db: Database, config: Pick<AppConfig, (typeof RETENTION)[number]["setting"]>): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const { table, setting } of RETENTION) {
    const days = config[setting];
    if (!days) continue;
    const { rows } = await db.query<{ n: number }>(
      `WITH gone AS (DELETE FROM ${table} WHERE created_at < now() - make_interval(days => $1) RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      [days],
    );
    removed[table] = rows[0]?.n ?? 0;
  }
  return removed;
}
