import { ChevronRight, Pill } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import { StatusBadge } from "./status-badge";

/**
 * A medication exactly as recorded: name, the clinician's or label's
 * instruction word for word, schedule and the last 7 days. Never suggests
 * a dose change.
 */
export function MedicationCard({
  name,
  instruction,
  sourceLabel,
  schedule,
  takenToday,
  lastSevenDays,
  href,
  active = true,
  className,
}: {
  name: string;
  instruction: string;
  sourceLabel: string;
  schedule?: string;
  takenToday?: boolean;
  /** Oldest first: true taken, false missed, null not scheduled. */
  lastSevenDays?: (boolean | null)[];
  href?: string;
  active?: boolean;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        <IconBadge icon={<Pill />} tone={active ? "blue" : "purple"} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-text-primary">{name}</p>
          <p className="text-caption text-text-secondary">“{instruction}”</p>
          <p className="mt-1 text-xs text-text-muted">
            {sourceLabel}
            {schedule ? ` · ${schedule}` : ""}
          </p>
        </div>
        {!active ? <StatusBadge status="neutral">Stopped</StatusBadge> : takenToday ? <StatusBadge status="success">Taken today</StatusBadge> : null}
        {href && <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />}
      </div>
      {lastSevenDays && lastSevenDays.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5" aria-label={`Last 7 days: ${lastSevenDays.filter((d) => d === true).length} of ${lastSevenDays.filter((d) => d !== null).length} doses logged`}>
          {lastSevenDays.map((d, i) => (
            <span key={i} aria-hidden className={cn("h-1.5 flex-1 rounded-pill", d === true ? "bg-success-fill" : d === false ? "bg-warning-soft ring-1 ring-warning/40" : "bg-card-muted")} />
          ))}
        </div>
      )}
    </>
  );
  const base = cn("block rounded-lg bg-card p-4 shadow-card", href && "lift", className);
  return href ? (
    <Link href={href} className={base}>
      {content}
    </Link>
  ) : (
    <div className={base}>{content}</div>
  );
}
