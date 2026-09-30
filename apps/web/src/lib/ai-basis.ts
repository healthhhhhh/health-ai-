import type { AnswerContext, MeasurementKind } from "@healthmate/shared-types";

const METRIC: Partial<Record<MeasurementKind, string>> = {
  sleep: "sleep",
  steps: "steps",
  active_energy: "activity",
  heart_rate: "heart rate",
  resting_heart_rate: "resting heart rate",
  weight: "weight",
  blood_pressure_systolic: "blood pressure",
  blood_pressure_diastolic: "blood pressure",
  blood_glucose: "blood glucose",
  water: "water",
};

const list = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/**
 * What an AI answer was based on, in plain words — for the "AI-generated ·
 * based on …" label (CLAUDE.md: AI content shows what it was based on).
 * Null when nothing from the person's record was used.
 */
export function describeBasis(context: AnswerContext | undefined): string | null {
  if (!context) return null;
  const parts: string[] = [];
  const count = context.memories.length;
  if (count) parts.push(count === 1 ? "1 thing from your health memory" : `${count} things from your health memory`);
  if (context.usedProfile) parts.push("your health profile");
  const metrics = [...new Set(context.healthMetrics.map((k) => METRIC[k] ?? k))];
  if (metrics.length) parts.push(`your ${list(metrics)} data`);
  return parts.length ? list(parts) : null;
}
