import type { MeasurementKind } from "@healthmate/shared-types";

/** Readings a person can add by hand, with sensible input limits (not clinical thresholds). */
export const READING_TYPES: { kind: MeasurementKind; label: string; unit: string; min: number; max: number; step: number; format: (v: number) => string }[] = [
  { kind: "weight", label: "Weight", unit: "kg", min: 20, max: 350, step: 0.1, format: (v) => `${v} kg` },
  { kind: "resting_heart_rate", label: "Resting heart rate", unit: "bpm", min: 25, max: 220, step: 1, format: (v) => `${v} bpm` },
  { kind: "sleep", label: "Sleep", unit: "h", min: 0, max: 24 * 60, step: 1, format: (v) => `${Math.floor(v / 60)}h` },
  { kind: "steps", label: "Steps", unit: "steps", min: 0, max: 100_000, step: 1, format: (v) => `${v.toLocaleString("en-US")} steps` },
];
