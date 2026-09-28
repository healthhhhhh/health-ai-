import type { MeasurementKind, MetricTrend } from "@healthmate/shared-types";
import type { Tone } from "@/lib/tone";

export interface MetricDef {
  kind: MeasurementKind;
  title: string;
  unit?: string;
  chart: "bar" | "line";
  tone: Tone;
  /** Daily totals vs daily averages. */
  summary: "Daily average" | "Average";
}

export const HEALTH_METRICS: MetricDef[] = [
  { kind: "steps", title: "Steps", chart: "bar", tone: "green", summary: "Daily average" },
  { kind: "heart_rate", title: "Heart rate", unit: "bpm", chart: "line", tone: "red", summary: "Average" },
  { kind: "resting_heart_rate", title: "Resting heart rate", unit: "bpm", chart: "line", tone: "red", summary: "Average" },
  { kind: "sleep", title: "Sleep", chart: "bar", tone: "purple", summary: "Daily average" },
  { kind: "active_energy", title: "Active energy", unit: "kcal", chart: "bar", tone: "orange", summary: "Daily average" },
  { kind: "weight", title: "Weight", unit: "kg", chart: "line", tone: "teal", summary: "Average" },
];

export function formatMetric(kind: MeasurementKind, value: number): string {
  if (kind === "sleep") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  if (kind === "weight") return value.toFixed(1);
  return Math.round(value).toLocaleString("en-US");
}

/** Comparison with the person's own previous period. Never "normal" or "healthy". */
export function trendLabel(trend: MetricTrend): string {
  switch (trend) {
    case "in_usual_range":
      return "In your usual range";
    case "above_usual":
      return "Higher than your usual";
    case "below_usual":
      return "Lower than your usual";
    case "no_baseline":
      return "Building your baseline";
  }
}
