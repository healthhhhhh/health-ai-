"use client";

import { useEffect, useRef, useState } from "react";

const NUMERIC = /^[\d,]+(\.\d+)?$/;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts up to a formatted number ("6,428") the first time it mounts.
 * Non-numeric values ("7h 12m") render as-is. SSR renders the final value, so
 * the number is always correct without JavaScript.
 */
export function AnimatedNumber({ value, durationMs = 900 }: { value: string; durationMs?: number }) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!NUMERIC.test(value) || prefersReducedMotion()) {
      frame.current = requestAnimationFrame(() => setDisplay(value));
      return () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }
    const target = Number(value.replace(/,/g, ""));
    const decimals = value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
    const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fmt.format(target * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  // Screen readers get the final value immediately, not every intermediate frame.
  return (
    <>
      <span aria-hidden className="tabular-nums">
        {display}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}
