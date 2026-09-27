import { Pill } from "lucide-react";
import { IconBadge } from "./icon-badge";
import { StatusBadge } from "./status-badge";

/**
 * Displays a medication exactly as recorded. It never suggests a dose change;
 * `instruction` must come from the clinician or the user, verbatim.
 */
export function MedicationRow({ name, instruction, sourceLabel, nextDose, taken }: { name: string; instruction: string; sourceLabel: string; nextDose?: string; taken?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <IconBadge icon={<Pill />} tone="blue" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-text-primary">{name}</p>
        <p className="truncate text-caption text-text-secondary">
          {instruction} · {sourceLabel}
        </p>
      </div>
      {taken ? <StatusBadge status="success">Taken</StatusBadge> : nextDose && <span className="text-caption text-text-secondary tabular-nums">{nextDose}</span>}
    </div>
  );
}
