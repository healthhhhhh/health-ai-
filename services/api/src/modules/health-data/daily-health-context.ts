/**
 * A compact, relevant summary of the person's daily health data for the AI
 * Health Assistant: only the metrics the question is about, the last 7 days
 * against the person's own previous 30 days ("usual range" — never "normal").
 * Pure functions (unit-tested). See docs/phase2c-plan.md §2.2.
 */
import type { DailyRecord, MeasurementKind } from "./health-data.service";

const TOPICS: [RegExp, MeasurementKind[]][] = [
  [/\b(tired\w*|fatigue\w*|exhausted|energy|drained|worn out)\b/i, ["sleep", "steps", "resting_heart_rate"]],
  [/\b(sleep\w*|slept|insomnia|nap\w*|bedtime|wake up|waking)\b/i, ["sleep"]],
  [/\b(steps?|walk\w*|activ\w*|exercis\w*|workout|move|moving|sedentary)\b/i, ["steps", "active_energy"]],
  [/\b(heart|pulse|bpm|palpitation\w*|racing)\b/i, ["heart_rate", "resting_heart_rate"]],
  [/\b(weight|weigh|kg|lbs?|pounds|bmi)\b/i, ["weight"]],
  [/\b(blood pressure|bp|hypertension)\b/i, ["blood_pressure_systolic", "blood_pressure_diastolic"]],
  [/\b(glucose|blood sugar|diabet\w*)\b/i, ["blood_glucose"]],
  [/\b(water|hydrat\w*|thirst\w*|drink\w*)\b/i, ["water"]],
  [/\b(trends?|overall|how am i doing|health data|apple health|my data|this week|lately|recently)\b/i, ["steps", "sleep", "resting_heart_rate"]],
];

/** Metrics a question is about (empty when it isn't about any). */
export function relevantMetrics(question: string): MeasurementKind[] {
  const kinds = new Set<MeasurementKind>();
  for (const [re, list] of TOPICS) if (re.test(question)) for (const k of list) kinds.add(k);
  return [...kinds];
}

const LABEL: Record<MeasurementKind, string> = {
  heart_rate: "Heart rate",
  resting_heart_rate: "Resting heart rate",
  steps: "Steps",
  sleep: "Sleep",
  active_energy: "Active energy",
  weight: "Weight",
  blood_pressure_systolic: "Blood pressure (systolic)",
  blood_pressure_diastolic: "Blood pressure (diastolic)",
  blood_glucose: "Blood glucose",
  water: "Water",
};

export function formatValue(kind: MeasurementKind, value: number): string {
  switch (kind) {
    case "sleep": {
      const minutes = Math.round(value);
      return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    }
    case "steps":
      return `${Math.round(value).toLocaleString("en-GB")} steps`;
    case "heart_rate":
    case "resting_heart_rate":
      return `${Math.round(value)} bpm`;
    case "weight":
      return `${value.toFixed(1)} kg`;
    case "active_energy":
      return `${Math.round(value)} kcal`;
    case "water":
      return `${Math.round(value)} ml`;
    case "blood_pressure_systolic":
    case "blood_pressure_diastolic":
      return `${Math.round(value)} mmHg`;
    case "blood_glucose":
      return `${Math.round(value)} mg/dL`;
  }
}

const shift = (day: string, offset: number) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export type UsualComparison = "within" | "above" | "below" | "unknown";

/** Recent average against the person's own spread: within one standard deviation (or 5%) counts as usual. */
export function compareToUsual(recent: number[], baseline: number[]): UsualComparison {
  if (recent.length < 3 || baseline.length < 7) return "unknown";
  const m = mean(baseline);
  const sd = Math.sqrt(mean(baseline.map((v) => (v - m) ** 2)));
  const band = Math.max(sd, Math.abs(m) * 0.05);
  const r = mean(recent);
  return r > m + band ? "above" : r < m - band ? "below" : "within";
}

export interface DailyHealthContext {
  lines: string[];
  /** Metrics that actually had data (for "based on"). */
  metrics: MeasurementKind[];
}

/**
 * One line per relevant metric with data, e.g.
 * "Sleep (Apple Health): average 6 h 10 min over the last 7 days (2026-09-24 to 2026-09-30) — below your usual range (usual about 7 h 5 min over the previous 30 days)".
 * Days still in progress (today) are left out of averages.
 */
export function dailyHealthContext(records: DailyRecord[], kinds: MeasurementKind[], today: string): DailyHealthContext {
  const lines: string[] = [];
  const metrics: MeasurementKind[] = [];
  const recentFrom = shift(today, -7);
  const baselineFrom = shift(today, -37);
  for (const kind of kinds) {
    const rows = records.filter((r) => r.kind === kind && r.isComplete);
    const recent = rows.filter((r) => r.day >= recentFrom && r.day < today);
    const baseline = rows.filter((r) => r.day >= baselineFrom && r.day < recentFrom);
    if (!recent.length) continue;
    const sources = [...new Set(recent.map((r) => (r.source === "apple_health" ? "Apple Health" : "entered by you")))].join(" and ");
    const avg = mean(recent.map((r) => r.value));
    const comparison = compareToUsual(recent.map((r) => r.value), baseline.map((r) => r.value));
    const period = `${recent.length === 1 ? "1 day" : `${recent.length} days`} of the last 7 (${recent[0]!.day} to ${recent[recent.length - 1]!.day})`;
    const usual =
      comparison === "unknown"
        ? " — not enough earlier data to compare with your usual range"
        : ` — ${comparison} your usual range (usual about ${formatValue(kind, mean(baseline.map((r) => r.value)))} over the previous 30 days)`;
    lines.push(`${LABEL[kind]} (${sources}): average ${formatValue(kind, avg)} over ${period}${usual}`);
    metrics.push(kind);
  }
  return { lines, metrics };
}
