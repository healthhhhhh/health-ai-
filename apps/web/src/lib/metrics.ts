import type { HealthMetric, MetricKind, MetricTrend } from "@healthmate/shared-types";
import type { Tone } from "./tone";
import { formatDuration, formatNumber } from "./format";

export interface MetricPresentation {
  label: string;
  tone: Tone;
  value: string;
  unit?: string;
  context?: string;
}

const META: Record<MetricKind, { label: string; tone: Tone }> = {
  heart_rate: { label: "Heart Rate", tone: "red" },
  steps: { label: "Steps", tone: "green" },
  sleep: { label: "Sleep", tone: "purple" },
  calories: { label: "Calories", tone: "orange" },
  water: { label: "Water", tone: "blue" },
  weight: { label: "Weight", tone: "teal" },
  blood_pressure: { label: "Blood Pressure", tone: "blue" },
};

/**
 * Plain-language comparison to the user's own baseline. Deliberately avoids
 * words like "healthy" or "normal" — this is context, not a clinical judgement.
 */
export const TREND_LABEL: Record<MetricTrend, string> = {
  in_usual_range: "In your usual range",
  above_usual: "Higher than your usual",
  below_usual: "Lower than your usual",
  no_baseline: "Building your baseline",
};

export function presentMetric(metric: HealthMetric): MetricPresentation {
  const meta = META[metric.kind];
  const goalContext = metric.goal ? `${Math.round((metric.value / metric.goal) * 100)}% of your goal` : undefined;
  switch (metric.kind) {
    case "sleep":
      return { ...meta, value: formatDuration(metric.value), context: TREND_LABEL[metric.trend] };
    case "steps":
      return { ...meta, value: formatNumber(metric.value), context: goalContext ?? TREND_LABEL[metric.trend] };
    case "water":
      return { ...meta, value: `${metric.value}${metric.goal ? ` / ${metric.goal}` : ""}`, unit: metric.unit, context: goalContext };
    case "calories":
      return { ...meta, value: formatNumber(metric.value), unit: metric.unit, context: "Active energy today" };
    default:
      return { ...meta, value: formatNumber(metric.value), unit: metric.unit, context: TREND_LABEL[metric.trend] };
  }
}
