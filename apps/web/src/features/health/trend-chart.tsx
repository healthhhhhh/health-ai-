"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import type { MeasurementKind } from "@healthmate/shared-types";
import { toneClasses, type Tone } from "@/lib/tone";
import { formatMetric } from "./metrics";

export interface TrendPointView {
  date: string;
  value: number;
}

/** Rounds up to a clean axis maximum (1, 2, 2.5, 5 × 10^n). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

/**
 * Axis range for a chart. Columns (daily totals) start at zero; lines
 * (averages like heart rate or weight) zoom to the data with a little room,
 * so a 72.4 → 72.1 kg change is visible instead of a flat line.
 */
export function chartDomain(values: number[], kind: "bar" | "line"): [number, number] {
  if (values.length === 0) return [0, 1];
  const hi = Math.max(...values);
  if (kind === "bar") return [0, niceMax(hi)];
  const lo = Math.min(...values);
  const room = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.02, 1);
  const step = niceMax((hi - lo + 2 * room) / 4);
  return [Math.max(0, Math.floor((lo - room) / step) * step), Math.ceil((hi + room) / step) * step];
}

/**
 * One metric over time: columns for daily totals, a 2px line for averages.
 * Single series (the title names it), recessive axis, hover/focus tooltip per
 * day, and the same values in a table for screen readers.
 */
export function TrendChart({
  label,
  points,
  kind,
  tone,
  metric,
  baseline,
}: {
  label: string;
  points: TrendPointView[];
  kind: "bar" | "line";
  tone: Tone;
  metric: MeasurementKind;
  baseline?: number | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const format = (value: number) => formatMetric(metric, value);
  const tableId = useId();
  const W = 640;
  const H = 180;
  const pad = { top: 16, right: 12, bottom: 24, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const [min, max] = chartDomain([...points.map((p) => p.value), ...(baseline != null && baseline > 0 ? [baseline] : [])], kind);
  const band = innerW / Math.max(points.length, 1);
  const barW = Math.min(24, band - 2);
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;
  // Dots help on a week or a month; beyond that the line alone reads better.
  const showDots = points.length <= 31;
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const color = toneClasses[tone].fg;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={`${label} chart`} aria-describedby={tableId}>
        {[min, (min + max) / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="stroke-separator" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-text-muted text-[11px]">
              {format(t)}
            </text>
          </g>
        ))}
        {baseline != null && baseline > 0 && (
          <g>
            <line x1={pad.left} x2={W - pad.right} y1={y(baseline)} y2={y(baseline)} className="stroke-text-muted" strokeWidth={1} />
            <text x={W - pad.right} y={y(baseline) - 4} textAnchor="end" className="fill-text-secondary text-[11px]">
              Your usual
            </text>
          </g>
        )}
        <g className={color}>
          {kind === "bar"
            ? points.map((p, i) => {
                const top = y(p.value);
                const h = Math.max(pad.top + innerH - top, 1);
                const r = Math.min(4, h, barW / 2);
                const x0 = x(i) - barW / 2;
                // Rounded data end, square at the baseline.
                const d = `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z`;
                return <path key={p.date} d={d} className={cn("fill-current transition-opacity", active !== null && active !== i && "opacity-40")} />;
              })
            : (
              <>
                <polyline
                  points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
                  fill="none"
                  className="stroke-current"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((p, i) =>
                  showDots || active === i ? <circle key={p.date} cx={x(i)} cy={y(p.value)} r={active === i ? 6 : 4} className="fill-current stroke-card" strokeWidth={2} /> : null,
                )}
              </>
            )}
        </g>
        {points.length > 0 && (
          <>
            <text x={x(0)} y={H - 6} textAnchor="start" className="fill-text-muted text-[11px]">
              {day(points[0]!.date)}
            </text>
            <text x={x(points.length - 1)} y={H - 6} textAnchor="end" className="fill-text-muted text-[11px]">
              {day(points.at(-1)!.date)}
            </text>
          </>
        )}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={pad.left + band * i}
            y={pad.top}
            width={band}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            role="img"
            aria-label={`${day(p.date)}: ${format(p.value)}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="outline-none focus-visible:stroke-primary"
          />
        ))}
      </svg>
      {active !== null && points[active] && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-card px-2.5 py-1.5 text-caption shadow-raised ring-1 ring-separator"
          style={{ left: `${(x(active) / W) * 100}%` }}
        >
          <span className="text-text-secondary">{day(points[active]!.date)}</span> <span className="font-semibold text-text-primary">{format(points[active]!.value)}</span>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-caption font-semibold text-primary">Show as table</summary>
        <table id={tableId} className="mt-2 w-full text-left text-caption">
          <caption className="sr-only">{label} by day</caption>
          <thead>
            <tr className="text-text-secondary">
              <th scope="col" className="py-1 font-semibold">
                Day
              </th>
              <th scope="col" className="py-1 font-semibold">
                {label}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-t border-separator">
                <td className="py-1">{day(p.date)}</td>
                <td className="py-1 tabular-nums">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
