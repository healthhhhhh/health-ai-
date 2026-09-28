import { FlaskConical } from "lucide-react";

/** Shown when the account or server holds demo content, so it's never mistaken for real health data. */
export function SampleDataNotice({ children = "Demo mode — content shown is example data, not real health data." }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
      <FlaskConical aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}
