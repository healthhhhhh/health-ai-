import type { MeasurementKind } from "@healthmate/shared-types";

/** Per-browser display choices (appearance and units). Kept in a cookie; nothing is sent to the server's database. */
export interface DisplayPrefs {
  theme: "system" | "light" | "dark";
  units: "metric" | "imperial";
}

export const DISPLAY_COOKIE = "hm_display";
export const DEFAULT_DISPLAY: DisplayPrefs = { theme: "system", units: "metric" };

export function parseDisplayPrefs(raw: string | undefined): DisplayPrefs {
  try {
    const v = JSON.parse(decodeURIComponent(raw ?? "")) as Partial<DisplayPrefs>;
    return {
      theme: v.theme === "light" || v.theme === "dark" ? v.theme : "system",
      units: v.units === "imperial" ? "imperial" : "metric",
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

const LB_PER_KG = 2.20462262;

/** A stored (metric) value in the person's units. Only weight differs today. */
export function toDisplay(kind: MeasurementKind, value: number, units: DisplayPrefs["units"]): number {
  return kind === "weight" && units === "imperial" ? value * LB_PER_KG : value;
}

/** A value typed in the person's units, back to the stored metric value. */
export function fromDisplay(kind: MeasurementKind, value: number, units: DisplayPrefs["units"]): number {
  return kind === "weight" && units === "imperial" ? value / LB_PER_KG : value;
}

export function unitFor(kind: MeasurementKind, units: DisplayPrefs["units"], fallback?: string): string | undefined {
  return kind === "weight" ? (units === "imperial" ? "lb" : "kg") : fallback;
}

/** A trend in the person's units (weight in lb when imperial). */
export function trendForDisplay<T extends { kind: MeasurementKind; unit: string; points: { value: number; min: number; max: number }[]; average: number | null; previousAverage: number | null }>(trend: T, units: DisplayPrefs["units"]): T {
  if (trend.kind !== "weight" || units === "metric") return trend;
  const c = (v: number) => toDisplay("weight", v, units);
  return {
    ...trend,
    unit: "lb",
    points: trend.points.map((p) => ({ ...p, value: c(p.value), min: c(p.min), max: c(p.max) })),
    average: trend.average == null ? null : c(trend.average),
    previousAverage: trend.previousAverage == null ? null : c(trend.previousAverage),
  };
}

/** Latest readings in the person's units. */
export function latestForDisplay<T extends { kind: MeasurementKind; value: number; unit: string }>(list: T[], units: DisplayPrefs["units"]): T[] {
  return list.map((m) => (m.kind === "weight" && units === "imperial" ? { ...m, value: toDisplay("weight", m.value, units), unit: "lb" } : m));
}
