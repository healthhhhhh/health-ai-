"use client";

import type { ConsentKind } from "@healthmate/shared-types";
import { useOptimistic, useState, useTransition } from "react";
import { setConsent } from "@/features/chat/actions";
import { cn } from "@/lib/cn";

export function ConsentToggle({ kind, title, description, granted }: { kind: ConsentKind; title: string; description: string; granted: boolean }) {
  const [value, setValue] = useOptimistic(granted);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = `consent-${kind}`;
  return (
    <div className="flex items-start gap-4 py-3">
      <div className="flex-1">
        <label htmlFor={id} className="text-body font-semibold text-text-primary">
          {title}
        </label>
        <p id={`${id}-desc`} className="text-caption text-text-secondary">
          {description}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-caption text-error">
            {error}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        aria-describedby={`${id}-desc`}
        onClick={() =>
          start(async () => {
            setError(null);
            setValue(!value);
            const res = await setConsent(kind, !value);
            if (!res.ok) setError(res.error);
          })
        }
        className={cn("relative mt-1 h-7 w-12 shrink-0 rounded-pill transition-colors", value ? "bg-primary-fill" : "bg-separator")}
      >
        <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-6 rounded-full bg-card shadow-card transition-transform motion-reduce:transition-none", value && "translate-x-5")} />
      </button>
    </div>
  );
}
