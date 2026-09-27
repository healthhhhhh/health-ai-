import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * AI-generated observation. Always labelled as AI-generated and shows what it
 * was based on, so it is never mistaken for a clinical finding.
 */
export function InsightCard({ title = "AI Insight", message, basedOn, badge, action, className }: { title?: string; message: string; basedOn: string; badge?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("rounded-lg bg-gradient-to-br from-purple-soft to-primary-soft p-5", className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-card text-purple">
          <Sparkles aria-hidden className="size-4" />
        </span>
        <h2 className="text-card-title text-text-primary">{title}</h2>
        {badge}
      </div>
      <p className="text-body text-text-primary">{message}</p>
      <p className="mt-2 text-caption text-text-secondary">
        AI-generated from {basedOn}. Not a diagnosis.
      </p>
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}
