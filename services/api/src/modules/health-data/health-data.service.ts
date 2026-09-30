import { Inject, Injectable } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";

/** Canonical kinds and units. Clients convert before sending (HealthKit does this natively). */
export const MEASUREMENT_UNITS = {
  heart_rate: "bpm",
  resting_heart_rate: "bpm",
  steps: "count",
  sleep: "min",
  active_energy: "kcal",
  weight: "kg",
  blood_pressure_systolic: "mmHg",
  blood_pressure_diastolic: "mmHg",
  blood_glucose: "mg/dL",
  water: "ml",
} as const;
export type MeasurementKind = keyof typeof MEASUREMENT_UNITS;

/** Plausibility bounds reject corrupt values (per reading and per day); they are not clinical thresholds. */
export const BOUNDS: Record<MeasurementKind, [number, number]> = {
  heart_rate: [20, 300],
  resting_heart_rate: [20, 250],
  steps: [0, 200_000],
  sleep: [0, 1_440],
  active_energy: [0, 20_000],
  weight: [1, 700],
  blood_pressure_systolic: [40, 300],
  blood_pressure_diastolic: [20, 200],
  blood_glucose: [10, 1_500],
  water: [0, 20_000],
};

/** Daily totals for cumulative kinds, daily averages for the rest. */
export const CUMULATIVE: MeasurementKind[] = ["steps", "sleep", "active_energy", "water"];

/** The previous iOS sync stored whole days as measurements with this external id. */
const LEGACY_DAY_ID = /^apple_health:([a-z_]+):(\d{4}-\d{2}-\d{2})$/;

export interface MeasurementInput {
  kind: MeasurementKind;
  value: number;
  recordedAt: string;
  source: "apple_health" | "user_entered";
  sourceDevice?: string | null;
  externalId?: string | null;
}

/** One day of one metric, computed on the iPhone by HealthKit. */
export interface DailyRecordInput {
  day: string;
  kind: MeasurementKind;
  value: number;
  min?: number | null;
  max?: number | null;
  sampleCount?: number | null;
  /** false while the day is still in progress (today). */
  isComplete: boolean;
  /** When the value was computed on the device (ISO). Newer replaces older. */
  computedAt: string;
}

export interface DailyRecord {
  day: string;
  kind: MeasurementKind;
  unit: string;
  value: number;
  min: number | null;
  max: number | null;
  sampleCount: number | null;
  source: "apple_health" | "user_entered";
  isComplete: boolean;
  timeZone: string;
  updatedAt: string;
}

export interface TrendPoint {
  date: string;
  value: number;
  min: number;
  max: number;
  count: number;
}

export type SyncRunKind = "initial_import" | "incremental" | "manual";
export type SyncRunStatus = "succeeded" | "partial" | "failed";

type SummaryRow = {
  day: string; kind: MeasurementKind; unit: string; value: number; min_value: number | null; max_value: number | null; sample_count: number | null;
  source: "apple_health" | "user_entered"; is_complete: boolean; time_zone: string; updated_at: Date;
};
const SUMMARY_COLUMNS = "day::text AS day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, updated_at";
const toRecord = (r: SummaryRow): DailyRecord => ({
  day: r.day,
  kind: r.kind,
  unit: r.unit,
  value: Number(r.value),
  min: r.min_value === null ? null : Number(r.min_value),
  max: r.max_value === null ? null : Number(r.max_value),
  sampleCount: r.sample_count,
  source: r.source,
  isComplete: r.is_complete,
  timeZone: r.time_zone,
  updatedAt: r.updated_at.toISOString(),
});

@Injectable()
export class HealthDataService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async timeZone(userId: string, tx: Queryable = this.db): Promise<string> {
    const { rows } = await tx.query<{ time_zone: string }>(`SELECT time_zone FROM profiles WHERE user_id = $1`, [userId]);
    return rows[0]?.time_zone ?? "UTC";
  }

  /**
   * Individual readings. Idempotent for Apple Health samples (same externalId).
   * Readings people enter are also summarised into that day's daily record.
   * Whole days sent by older iOS versions become Apple Health daily records.
   */
  async ingest(userId: string, measurements: MeasurementInput[]): Promise<{ inserted: number }> {
    let inserted = 0;
    const legacyDays: DailyRecordInput[] = [];
    await this.db.transaction(async (tx) => {
      const tz = await this.timeZone(userId, tx);
      const touched = new Map<string, { kind: MeasurementKind; day: string }>();
      for (const m of measurements) {
        const legacy = m.source === "apple_health" ? LEGACY_DAY_ID.exec(m.externalId ?? "") : null;
        if (legacy && legacy[1] === m.kind) {
          legacyDays.push({ day: legacy[2]!, kind: m.kind, value: m.value, isComplete: true, computedAt: new Date().toISOString() });
          continue;
        }
        const { rows } = await tx.query<{ day: string }>(
          `INSERT INTO health_measurements (user_id, kind, value, unit, recorded_at, source, source_device, external_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
           RETURNING (recorded_at AT TIME ZONE $9)::date::text AS day`,
          [userId, m.kind, m.value, MEASUREMENT_UNITS[m.kind], m.recordedAt, m.source, m.sourceDevice ?? null, m.externalId ?? null, tz],
        );
        inserted += rows.length;
        if (rows[0] && m.source === "user_entered") touched.set(`${m.kind}|${rows[0].day}`, { kind: m.kind, day: rows[0].day });
      }
      for (const { kind, day } of touched.values()) await this.recomputeUserEntered(tx, userId, kind, day, tz);
    });
    if (legacyDays.length) inserted += (await this.upsertDaily(userId, legacyDays, {})).upserted;
    if (measurements.some((m) => m.source === "apple_health")) await this.touchConnection(userId, measurements.find((m) => m.source === "apple_health" && m.sourceDevice)?.sourceDevice ?? null);
    return { inserted };
  }

  /** Summarises the person's own readings for one local day (totals or averages). */
  private async recomputeUserEntered(tx: Queryable, userId: string, kind: MeasurementKind, day: string, tz: string) {
    const agg = CUMULATIVE.includes(kind) ? "sum" : "avg";
    const { rows } = await tx.query<{ value: number | null; min: number | null; max: number | null; n: number }>(
      `SELECT ${agg}(value)::float8 AS value, min(value)::float8 AS min, max(value)::float8 AS max, count(*)::int AS n
         FROM health_measurements WHERE user_id = $1 AND kind = $2 AND source = 'user_entered' AND (recorded_at AT TIME ZONE $4)::date = $3::date`,
      [userId, kind, day, tz],
    );
    const r = rows[0];
    if (!r || r.n === 0 || r.value === null) {
      await tx.query(`DELETE FROM daily_health_records WHERE user_id = $1 AND kind = $2 AND day = $3 AND source = 'user_entered'`, [userId, kind, day]);
      return;
    }
    await tx.query(
      `INSERT INTO daily_health_records (user_id, day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user_entered', true, $9, now())
       ON CONFLICT (user_id, day, kind, source) DO UPDATE SET value = EXCLUDED.value, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
         sample_count = EXCLUDED.sample_count, time_zone = EXCLUDED.time_zone, computed_at = EXCLUDED.computed_at`,
      [userId, day, kind, MEASUREMENT_UNITS[kind], r.value, r.min, r.max, r.n, tz],
    );
  }

  /**
   * Apple Health daily values. A day is re-sent until it's settled; the newest
   * computation wins, an older one never overwrites a newer one, and an
   * unchanged value isn't rewritten.
   */
  async upsertDaily(
    userId: string,
    records: DailyRecordInput[],
    meta: { timeZone?: string; sourceDevice?: string | null; syncRunId?: string | null },
  ): Promise<{ upserted: number; unchanged: number; ignoredOlder: number }> {
    const result = { upserted: 0, unchanged: 0, ignoredOlder: 0 };
    if (!records.length) return result;
    await this.db.transaction(async (tx) => {
      const tz = meta.timeZone ?? (await this.timeZone(userId, tx));
      if (meta.syncRunId) {
        const owned = await tx.query(`SELECT 1 FROM health_sync_runs WHERE id = $1 AND user_id = $2`, [meta.syncRunId, userId]);
        if (!owned.rows[0]) throw notFound("Sync run");
      }
      const days = records.map((r) => r.day).sort();
      type Existing = { day: string; kind: string; value: number; min_value: number | null; max_value: number | null; sample_count: number | null; is_complete: boolean; computed_at: Date };
      const { rows } = await tx.query<Existing>(
        `SELECT day::text AS day, kind, value, min_value, max_value, sample_count, is_complete, computed_at FROM daily_health_records
          WHERE user_id = $1 AND source = 'apple_health' AND day BETWEEN $2::date AND $3::date`,
        [userId, days[0], days[days.length - 1]],
      );
      const existing = new Map(rows.map((r) => [`${r.kind}|${r.day}`, r]));
      // Last one wins within a batch too.
      const latest = new Map<string, DailyRecordInput>();
      for (const r of records) {
        const key = `${r.kind}|${r.day}`;
        const seen = latest.get(key);
        if (!seen || Date.parse(r.computedAt) >= Date.parse(seen.computedAt)) latest.set(key, r);
      }
      for (const [key, r] of latest) {
        const old = existing.get(key);
        if (old && old.computed_at.getTime() > Date.parse(r.computedAt)) {
          result.ignoredOlder += 1;
          continue;
        }
        const same =
          old &&
          Number(old.value) === r.value &&
          (old.min_value === null ? null : Number(old.min_value)) === (r.min ?? null) &&
          (old.max_value === null ? null : Number(old.max_value)) === (r.max ?? null) &&
          old.sample_count === (r.sampleCount ?? null) &&
          old.is_complete === r.isComplete;
        if (same) {
          result.unchanged += 1;
          continue;
        }
        await tx.query(
          `INSERT INTO daily_health_records (user_id, day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, source_device, sync_run_id, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'apple_health', $9, $10, $11, $12, $13)
           ON CONFLICT (user_id, day, kind, source) DO UPDATE SET value = EXCLUDED.value, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
             sample_count = EXCLUDED.sample_count, is_complete = EXCLUDED.is_complete, time_zone = EXCLUDED.time_zone,
             source_device = COALESCE(EXCLUDED.source_device, daily_health_records.source_device), sync_run_id = EXCLUDED.sync_run_id, computed_at = EXCLUDED.computed_at
           WHERE daily_health_records.computed_at <= EXCLUDED.computed_at`,
          [userId, r.day, r.kind, MEASUREMENT_UNITS[r.kind], r.value, r.min ?? null, r.max ?? null, r.sampleCount ?? null, r.isComplete, tz, meta.sourceDevice ?? null, meta.syncRunId ?? null, r.computedAt],
        );
        result.upserted += 1;
      }
    });
    await this.touchConnection(userId, meta.sourceDevice ?? null);
    return result;
  }

  /** One value per day and metric (Apple Health preferred), oldest first. */
  async daily(userId: string, from: string, to: string, kinds?: MeasurementKind[]): Promise<DailyRecord[]> {
    const { rows } = await this.db.query<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM daily_health_summary
        WHERE user_id = $1 AND day BETWEEN $2::date AND $3::date AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
        ORDER BY day, kind`,
      [userId, from, to, kinds?.length ? kinds : null],
    );
    return rows.map(toRecord);
  }

  async trend(userId: string, kind: MeasurementKind, days: number, timeZone: string): Promise<{ kind: MeasurementKind; unit: string; points: TrendPoint[]; average: number | null; previousAverage: number | null }> {
    // Calendar days in the person's time zone: the last `days` days including today, and the period before.
    const query = (fromAgo: number, toAgo: number) =>
      this.db.query<{ day: string; value: number; min_value: number | null; max_value: number | null; sample_count: number | null }>(
        `SELECT day::text AS day, value, min_value, max_value, sample_count FROM daily_health_summary
          WHERE user_id = $1 AND kind = $2 AND day > (now() AT TIME ZONE $3)::date - $4::int AND day <= (now() AT TIME ZONE $3)::date - $5::int
          ORDER BY day`,
        [userId, kind, timeZone, fromAgo, toAgo],
      );
    const [current, previous] = await Promise.all([query(days, 0), query(days * 2, days)]);
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    return {
      kind,
      unit: MEASUREMENT_UNITS[kind],
      points: current.rows.map((r) => ({
        date: r.day,
        value: Number(r.value),
        min: Number(r.min_value ?? r.value),
        max: Number(r.max_value ?? r.value),
        count: r.sample_count ?? 1,
      })),
      average: avg(current.rows.map((r) => Number(r.value))),
      previousAverage: avg(previous.rows.map((r) => Number(r.value))),
    };
  }

  /** The newest value per metric: today's Apple Health value so far, or the latest reading entered. */
  async latest(userId: string): Promise<{ kind: MeasurementKind; value: number; unit: string; recordedAt: string; source: string }[]> {
    const { rows } = await this.db.query<{ kind: MeasurementKind; value: number; unit: string; recorded_at: Date; source: string }>(
      `SELECT DISTINCT ON (kind) kind, value, unit, recorded_at, source FROM (
         (SELECT kind, value, unit, recorded_at, source FROM health_measurements WHERE user_id = $1 AND source = 'user_entered')
         UNION ALL
         (SELECT DISTINCT ON (kind) kind, value, unit, computed_at AS recorded_at, source FROM daily_health_records WHERE user_id = $1 AND source = 'apple_health' ORDER BY kind, day DESC)
       ) latest ORDER BY kind, recorded_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ kind: r.kind, value: Number(r.value), unit: r.unit, recordedAt: r.recorded_at.toISOString(), source: r.source }));
  }

  // ── Apple Health connection & sync runs ─────────────────────────────────

  private async touchConnection(userId: string, device: string | null) {
    await this.db.query(
      `INSERT INTO healthkit_connections (user_id, status, device_name, last_sync_at) VALUES ($1, 'connected', $2, now())
       ON CONFLICT (user_id) DO UPDATE SET status = 'connected', disconnected_at = NULL, last_sync_at = now(),
         device_name = COALESCE(EXCLUDED.device_name, healthkit_connections.device_name),
         connected_at = CASE WHEN healthkit_connections.status = 'disconnected' THEN now() ELSE healthkit_connections.connected_at END`,
      [userId, device],
    );
  }

  async connection(userId: string) {
    const { rows } = await this.db.query<{
      status: string; device_name: string | null; scopes: string[]; connected_at: Date; disconnected_at: Date | null; last_sync_at: Date | null;
      history_status: "not_started" | "importing" | "complete" | "failed"; history_from: string | null; history_days_requested: number | null; last_error_code: string | null; last_error_at: Date | null;
    }>(
      `SELECT status, device_name, scopes, connected_at, disconnected_at, last_sync_at, history_status, history_from::text AS history_from, history_days_requested, last_error_code, last_error_at
         FROM healthkit_connections WHERE user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) {
      return {
        status: "never_connected" as const, deviceName: null, scopes: [], connectedAt: null, disconnectedAt: null, lastSyncAt: null,
        history: { status: "not_started" as const, from: null, daysRequested: null }, lastError: null,
      };
    }
    return {
      status: r.status as "connected" | "disconnected",
      deviceName: r.device_name,
      scopes: r.scopes,
      connectedAt: r.connected_at.toISOString(),
      disconnectedAt: r.disconnected_at?.toISOString() ?? null,
      lastSyncAt: r.last_sync_at?.toISOString() ?? null,
      history: { status: r.history_status, from: r.history_from, daysRequested: r.history_days_requested },
      lastError: r.last_error_code ? { code: r.last_error_code, at: r.last_error_at!.toISOString() } : null,
    };
  }

  /** Records which data types the person granted on their iPhone. */
  async connect(userId: string, input: { deviceName?: string | null; deviceId?: string | null; scopes: string[]; historyDays?: number | null }) {
    await this.db.query(
      `INSERT INTO healthkit_connections (user_id, status, device_name, device_id, scopes, history_days_requested) VALUES ($1, 'connected', $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET status = 'connected', disconnected_at = NULL, scopes = EXCLUDED.scopes,
         device_name = COALESCE(EXCLUDED.device_name, healthkit_connections.device_name),
         device_id = COALESCE(EXCLUDED.device_id, healthkit_connections.device_id),
         history_days_requested = COALESCE(EXCLUDED.history_days_requested, healthkit_connections.history_days_requested),
         connected_at = CASE WHEN healthkit_connections.status = 'disconnected' THEN now() ELSE healthkit_connections.connected_at END`,
      [userId, input.deviceName ?? null, input.deviceId ?? null, input.scopes, input.historyDays ?? null],
    );
    return this.connection(userId);
  }

  async startSyncRun(userId: string, input: { kind: SyncRunKind; deviceId?: string | null }): Promise<{ id: string }> {
    const { rows } = await this.db.query<{ id: string }>(`INSERT INTO health_sync_runs (user_id, device_id, kind) VALUES ($1, $2, $3) RETURNING id`, [userId, input.deviceId ?? null, input.kind]);
    if (input.kind === "initial_import") {
      await this.db.query(
        `INSERT INTO healthkit_connections (user_id, status, device_id, history_status) VALUES ($1, 'connected', $2, 'importing')
         ON CONFLICT (user_id) DO UPDATE SET history_status = CASE WHEN healthkit_connections.history_status = 'complete' THEN 'complete' ELSE 'importing' END,
           device_id = COALESCE(EXCLUDED.device_id, healthkit_connections.device_id)`,
        [userId, input.deviceId ?? null],
      );
    }
    return { id: rows[0]!.id };
  }

  async finishSyncRun(
    userId: string,
    id: string,
    input: { status: SyncRunStatus; daysSent: number; recordsUpserted: number; oldestDay?: string | null; newestDay?: string | null; errorCode?: string | null; historyComplete?: boolean },
  ) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ kind: SyncRunKind }>(
        `UPDATE health_sync_runs SET status = $3, days_sent = $4, records_upserted = $5, oldest_day = $6, newest_day = $7, error_code = $8, finished_at = now()
          WHERE id = $2 AND user_id = $1 AND finished_at IS NULL RETURNING kind`,
        [userId, id, input.status, input.daysSent, input.recordsUpserted, input.oldestDay ?? null, input.newestDay ?? null, input.errorCode ?? null],
      );
      if (!rows[0]) throw notFound("Sync run");
      const ok = input.status !== "failed";
      await tx.query(
        `UPDATE healthkit_connections SET
           last_sync_at = CASE WHEN $2 THEN now() ELSE last_sync_at END,
           last_error_code = CASE WHEN $3::text IS NULL AND $2 THEN NULL ELSE COALESCE($3, last_error_code) END,
           last_error_at = CASE WHEN $3::text IS NOT NULL THEN now() WHEN $2 THEN NULL ELSE last_error_at END,
           history_from = CASE WHEN $4::date IS NULL THEN history_from WHEN history_from IS NULL OR $4::date < history_from THEN $4::date ELSE history_from END,
           history_status = CASE WHEN $5 THEN 'complete' WHEN $6 = 'initial_import' AND NOT $2 THEN 'failed' ELSE history_status END
         WHERE user_id = $1`,
        [userId, ok, input.errorCode ?? null, ok ? (input.oldestDay ?? null) : null, input.historyComplete === true && ok, rows[0].kind],
      );
    });
    return this.connection(userId);
  }

  /** Removes everything synced from Apple Health (used when the person disconnects it). */
  async removeSource(userId: string, source: "apple_health"): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(`DELETE FROM health_measurements WHERE user_id = $1 AND source = $2 RETURNING id`, [userId, source]);
      const daily = await tx.query(`DELETE FROM daily_health_records WHERE user_id = $1 AND source = $2 RETURNING id`, [userId, source]);
      await tx.query(`DELETE FROM health_sync_runs WHERE user_id = $1`, [userId]);
      await tx.query(
        `UPDATE healthkit_connections SET status = 'disconnected', disconnected_at = now(), history_status = 'not_started', history_from = NULL, last_error_code = NULL, last_error_at = NULL WHERE user_id = $1`,
        [userId],
      );
      return rows.length + daily.rows.length;
    });
  }
}
