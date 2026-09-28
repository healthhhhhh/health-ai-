import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../db/database";

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

/** Daily totals for cumulative kinds, daily averages for the rest. */
const CUMULATIVE: MeasurementKind[] = ["steps", "sleep", "active_energy", "water"];

export interface MeasurementInput {
  kind: MeasurementKind;
  value: number;
  recordedAt: string;
  source: "apple_health" | "user_entered";
  sourceDevice?: string | null;
  externalId?: string | null;
}

export interface TrendPoint {
  date: string;
  value: number;
  min: number;
  max: number;
  count: number;
}

@Injectable()
export class HealthDataService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Idempotent: re-sending a HealthKit sample (same externalId) is ignored. */
  async ingest(userId: string, measurements: MeasurementInput[]): Promise<{ inserted: number }> {
    let inserted = 0;
    await this.db.transaction(async (tx) => {
      for (const m of measurements) {
        const { rows } = await tx.query(
          `INSERT INTO health_measurements (user_id, kind, value, unit, recorded_at, source, source_device, external_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
          [userId, m.kind, m.value, MEASUREMENT_UNITS[m.kind], m.recordedAt, m.source, m.sourceDevice ?? null, m.externalId ?? null],
        );
        inserted += rows.length;
      }
    });
    return { inserted };
  }

  async trend(userId: string, kind: MeasurementKind, days: number, timeZone: string): Promise<{ kind: MeasurementKind; unit: string; points: TrendPoint[]; average: number | null; previousAverage: number | null }> {
    const agg = CUMULATIVE.includes(kind) ? "sum" : "avg";
    const query = (from: number, to: number) =>
      this.db.query<{ day: string; value: number; min: number; max: number; count: number }>(
        `SELECT to_char(date_trunc('day', recorded_at AT TIME ZONE $3), 'YYYY-MM-DD') AS day, ${agg}(value)::float8 AS value, min(value)::float8 AS min, max(value)::float8 AS max, count(*)::int AS count
         FROM health_measurements WHERE user_id = $1 AND kind = $2 AND recorded_at >= now() - ($4 || ' days')::interval AND recorded_at < now() - ($5 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [userId, kind, timeZone, String(from), String(to)],
      );
    const [current, previous] = await Promise.all([query(days, 0), query(days * 2, days)]);
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    return {
      kind,
      unit: MEASUREMENT_UNITS[kind],
      points: current.rows.map((r) => ({ date: r.day, value: r.value, min: r.min, max: r.max, count: r.count })),
      average: avg(current.rows.map((r) => r.value)),
      previousAverage: avg(previous.rows.map((r) => r.value)),
    };
  }

  async latest(userId: string): Promise<{ kind: MeasurementKind; value: number; unit: string; recordedAt: string; source: string }[]> {
    const { rows } = await this.db.query<{ kind: MeasurementKind; value: number; unit: string; recorded_at: Date; source: string }>(
      `SELECT DISTINCT ON (kind) kind, value, unit, recorded_at, source FROM health_measurements WHERE user_id = $1 ORDER BY kind, recorded_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ kind: r.kind, value: r.value, unit: r.unit, recordedAt: r.recorded_at.toISOString(), source: r.source }));
  }

  /** Removes everything synced from Apple Health (used when the person disconnects it). */
  async removeSource(userId: string, source: "apple_health"): Promise<number> {
    const { rows } = await this.db.query(`DELETE FROM health_measurements WHERE user_id = $1 AND source = $2 RETURNING id`, [userId, source]);
    return rows.length;
  }
}
