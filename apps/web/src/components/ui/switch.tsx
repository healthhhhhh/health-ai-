"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/** An on/off setting with a visible label and optional description (role=switch). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-4 py-3", className)}>
      <div className="flex-1">
        <label htmlFor={id} className="text-body font-semibold text-text-primary">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-caption text-text-secondary">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-1 h-7 w-12 shrink-0 rounded-pill transition-colors disabled:opacity-50", checked ? "bg-primary-fill" : "bg-separator")}
      >
        <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-6 rounded-full bg-card shadow-card transition-transform motion-reduce:transition-none", checked && "translate-x-5")} />
      </button>
    </div>
  );
}
