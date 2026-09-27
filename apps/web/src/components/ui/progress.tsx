import { cn } from "@/lib/cn";
import { toneClasses, type Tone } from "@/lib/tone";

export function ProgressBar({ value, max = 100, tone = "green", label, className }: { value: number; max?: number; tone?: Tone; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-2 w-full overflow-hidden rounded-pill bg-separator", className)}>
      <div className={cn("h-full rounded-pill transition-[width] duration-500", toneClasses[tone].fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A single-value meter ring. The number in the middle is the primary encoding; the ring is secondary. */
export function ProgressRing({ value, max = 100, size = 120, stroke = 10, tone = "green", label, children }: { value: number; max?: number; size?: number; stroke?: number; tone?: Tone; label: string; children?: React.ReactNode }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-separator" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn("animate-ring-draw transition-[stroke-dashoffset] duration-700", toneClasses[tone].fg)}
          style={{ "--ring-circumference": `${c}` } as React.CSSProperties}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
