"use client";

import { useEffect, useState } from "react";

const COLORS = ["var(--color-primary)", "var(--color-success)", "var(--color-purple)", "var(--color-warning)", "var(--color-teal)"];
const COUNT = 28;

/** A short, soft confetti burst. Changing `trigger` (to a value > 0) fires it. Decorative only. */
export function ConfettiBurst({ trigger }: { trigger: number }) {
  // The burst for `trigger` is visible until its timer marks it finished.
  // (Reduced motion is handled globally in CSS: particles end instantly.)
  const [finished, setFinished] = useState(0);

  useEffect(() => {
    if (trigger <= 0) return;
    const id = window.setTimeout(() => setFinished(trigger), 1000);
    return () => window.clearTimeout(id);
  }, [trigger]);

  if (trigger <= 0 || finished === trigger) return null;
  const burst = trigger;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {Array.from({ length: COUNT }, (_, i) => {
        const angle = (i / COUNT) * Math.PI * 2;
        const distance = 60 + ((i * 37) % 70);
        return (
          <span
            key={`${burst}-${i}`}
            className={i % 3 === 0 ? "animate-confetti absolute rounded-[2px]" : "animate-confetti absolute rounded-full"}
            style={
              {
                width: 7 + (i % 4),
                height: i % 3 === 0 ? 4 + (i % 3) : 7 + (i % 4),
                background: COLORS[i % COLORS.length],
                "--dx": `${Math.cos(angle) * distance}px`,
                "--dy": `${Math.sin(angle) * distance}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
