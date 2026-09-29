import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Step {
  label: string;
  detail?: string;
}

/** Ordered steps (e.g. upload → read → summarise) with the current one highlighted. */
export function StepProgress({ steps, current, className, label = "Progress" }: { steps: Step[]; current: number; className?: string; label?: string }) {
  return (
    <ol aria-label={label} className={cn("flex flex-col gap-3", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={step.label} aria-current={state === "active" ? "step" : undefined} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                state === "done" && "bg-success-fill text-on-primary",
                state === "active" && "bg-primary-fill text-on-primary motion-safe:animate-pulse",
                state === "todo" && "bg-card-muted text-text-muted ring-1 ring-separator",
              )}
            >
              {state === "done" ? <Check aria-hidden className="size-3.5" /> : i + 1}
            </span>
            <span className="flex flex-col">
              <span className={cn("text-body", state === "todo" ? "text-text-secondary" : "font-semibold text-text-primary")}>
                {step.label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
              </span>
              {step.detail && <span className="text-caption text-text-secondary">{step.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
