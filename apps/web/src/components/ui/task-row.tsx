"use client";

import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface TaskRowProps {
  title: string;
  detail?: string;
  time: string;
  completed: boolean;
  onToggle: (completed: boolean) => void;
  disabled?: boolean;
  /** Small provenance label, e.g. "From your clinician". */
  sourceLabel?: string;
  /** Opens the item's detail (instructions, schedule, history). */
  href?: string;
}

/** A plan task with a large, accessible completion checkbox (reference: "My Plan"). */
export function TaskRow({ title, detail, time, completed, onToggle, disabled, sourceLabel, href }: TaskRowProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="relative inline-flex size-6 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={completed}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="peer size-6 cursor-pointer appearance-none rounded-sm border-2 border-separator bg-card transition-colors checked:border-primary-fill checked:bg-primary-fill checked:animate-pop disabled:cursor-not-allowed"
        />
        <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto size-4 scale-50 text-on-primary opacity-0 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] peer-checked:scale-100 peer-checked:opacity-100" />
      </span>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className={cn("block text-body font-semibold text-text-primary transition-colors duration-300", completed && "text-text-secondary line-through decoration-text-muted")}>{title}</span>
        {(detail || sourceLabel) && (
          <span className="block truncate text-caption text-text-secondary">
            {detail}
            {detail && sourceLabel && " · "}
            {sourceLabel}
          </span>
        )}
      </label>
      <span className="shrink-0 text-caption text-text-secondary tabular-nums">{time}</span>
      {href && (
        <Link href={href} aria-label={`${title} details`} className="-mr-2 rounded-full p-2 text-text-muted transition-colors hover:bg-card-muted hover:text-text-primary">
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  );
}
