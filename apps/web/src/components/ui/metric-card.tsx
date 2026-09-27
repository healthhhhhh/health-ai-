import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { AnimatedNumber } from "./animated-number";
import { IconBadge } from "./icon-badge";

export interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  tone: Tone;
  /** Short context line, e.g. "In your usual range" or "64% of goal". Data → Context → Meaning. */
  context?: string;
  href?: string;
  layout?: "compact" | "stacked";
  /** Gentle heartbeat on the icon (heart rate). */
  beat?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function MetricCard({ label, value, unit, icon, tone, context, href, layout = "compact", beat, className, style }: MetricCardProps) {
  const body = (
    <>
      <IconBadge icon={icon} tone={tone} className={beat ? "animate-heartbeat" : undefined} />
      <div className="min-w-0">
        <p className="text-caption text-text-secondary">{label}</p>
        <p className="text-metric whitespace-nowrap text-text-primary">
          <AnimatedNumber value={value} />
          {unit && <span className="ml-1 text-body font-medium text-text-secondary">{unit}</span>}
        </p>
        {context && <p className="mt-0.5 line-clamp-2 text-xs font-medium text-text-secondary">{context}</p>}
      </div>
    </>
  );
  const classes = cn(
    "flex rounded-lg bg-card p-4 shadow-card transition-shadow",
    layout === "stacked" ? "flex-col gap-3" : "items-center gap-3",
    href && "lift hover:ring-1 hover:ring-primary-tint",
    className,
  );
  return href ? (
    <Link href={href} className={classes} style={style} aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}${context ? `, ${context}` : ""}`}>
      {body}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {body}
    </div>
  );
}
