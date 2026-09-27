import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

/** One entry of a vertical timeline. Render inside an <ol>. */
export function TimelineItem({ icon, tone, title, meta, time, isLast, compact }: { icon: ReactNode; tone: Tone; title: string; meta?: string; time: string; isLast?: boolean; compact?: boolean }) {
  return (
    <li className="relative flex gap-3">
      {!isLast && !compact && <span aria-hidden className="absolute top-10 bottom-0 left-4 w-px bg-separator" />}
      <IconBadge icon={icon} tone={tone} size="sm" />
      <div className={cn("flex min-w-0 flex-1 items-start justify-between gap-3", compact ? "py-1.5" : "pb-5")}>
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">{title}</p>
          {meta && <p className="text-caption text-text-secondary">{meta}</p>}
        </div>
        <span className="shrink-0 pt-0.5 text-caption text-text-secondary tabular-nums">{time}</span>
      </div>
    </li>
  );
}
