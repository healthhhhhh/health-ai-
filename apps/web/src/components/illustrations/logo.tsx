import { useId } from "react";
import { cn } from "@/lib/cn";

/** HealthMate logo mark: a heart with a pulse line. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const gradientId = `hm-logo-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#2F64EC" />
        </linearGradient>
      </defs>
      <path d="M24 41C14 34.5 5 27.5 5 17.8 5 11.8 9.6 7 15.4 7c3.6 0 6.7 1.9 8.6 4.8C25.9 8.9 29 7 32.6 7 38.4 7 43 11.8 43 17.8 43 27.5 34 34.5 24 41z" fill={`url(#${gradientId})`} />
      <path d="M11 23h8l3-6 4 11 3-5h8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight text-text-primary", className)}>
      <LogoMark size={size} />
      <span>HealthMate</span>
    </span>
  );
}
