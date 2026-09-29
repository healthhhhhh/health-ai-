import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

/** One entry of a vertical timeline. Render inside an <ol>. With `href`, the whole entry opens it. */
export function TimelineItem({
  icon,
  tone,
  title,
  meta,
  time,
  isLast,
  compact,
  href,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  meta?: string;
  time: string;
  isLast?: boolean;
  compact?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <IconBadge icon={icon} tone={tone} size="sm" />
      <div className={cn("flex min-w-0 flex-1 items-start justify-between gap-3", compact ? "py-1.5" : "pb-5")}>
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">{title}</p>
          {meta && <p className="text-caption text-text-secondary">{meta}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-caption text-text-secondary tabular-nums">
          {time}
          {href && <ChevronRight aria-hidden className="size-4 text-text-muted" />}
        </span>
      </div>
    </>
  );
  return (
    <li className="relative">
      {!isLast && !compact && <span aria-hidden className="absolute top-10 bottom-0 left-4 w-px bg-separator" />}
      {href ? (
        <Link href={href} className="-mx-2 flex gap-3 rounded-md px-2 transition-colors hover:bg-card-muted">
          {body}
        </Link>
      ) : (
        <div className="flex gap-3">{body}</div>
      )}
    </li>
  );
}
