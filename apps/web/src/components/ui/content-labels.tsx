import { FlaskConical, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export type Provenance = "user_reported" | "user_confirmed" | "clinician_provided" | "document_extracted" | "healthkit" | "apple_health" | "ai_inferred" | "sample" | "device";

const provenance: Record<Provenance, { label: string; className: string }> = {
  user_reported: { label: "You added this", className: "bg-card-muted text-text-secondary" },
  user_confirmed: { label: "Confirmed by you", className: "bg-success-soft text-success" },
  clinician_provided: { label: "From your clinician", className: "bg-teal-soft text-teal" },
  document_extracted: { label: "From a report", className: "bg-primary-soft text-primary" },
  healthkit: { label: "From Apple Health", className: "bg-error-soft text-error" },
  apple_health: { label: "From Apple Health", className: "bg-error-soft text-error" },
  device: { label: "From a device", className: "bg-error-soft text-error" },
  // AI inferences are never shown as fact.
  ai_inferred: { label: "Unconfirmed · AI suggestion", className: "bg-purple-soft text-purple" },
  sample: { label: "Sample", className: "bg-warning-soft text-warning" },
};

/** Where a piece of health information came from — shown next to every health fact. */
export function SourceBadge({ source, className }: { source: Provenance; className?: string }) {
  const p = provenance[source];
  return <span className={cn("inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold", p.className, className)}>{p.label}</span>;
}

/** Marks AI-written content and says what it was based on (CLAUDE.md). */
export function AIGeneratedLabel({ basedOn, className }: { basedOn?: string; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-text-muted", className)}>
      <Sparkles aria-hidden className="mt-px size-3.5 shrink-0 text-purple" />
      <span>
        AI-generated{basedOn ? ` · based on ${basedOn}` : ""} · not a diagnosis
      </span>
    </p>
  );
}

/** Marks Preview-mode sample content so it's never mistaken for real health data or advice. */
export function SampleContentLabel({ children = "Sample content in Preview mode — not real health data.", className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-md bg-warning-soft p-3 text-caption font-medium text-text-primary", className)}>
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}
