import { FlaskConical } from "lucide-react";

/** Shown whenever the app is rendering sample data, so it's never mistaken for the user's real health data. */
export function SampleDataNotice() {
  return (
    <p className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
      <FlaskConical aria-hidden className="size-3.5 shrink-0" />
      Demo mode — all health values shown are sample data, not real measurements.
    </p>
  );
}
