import { Check, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

export type PermissionStatus = "prompt" | "granted" | "denied" | "unavailable";

/**
 * Explains why HealthMate asks for a permission before the system prompt,
 * what is (and isn't) shared, and how to change it later. Covers the granted,
 * denied (with how to re-enable) and unavailable states too.
 */
export function PermissionPrimer({
  icon,
  tone = "blue",
  title,
  description,
  benefits,
  privacyNote,
  status = "prompt",
  deniedHelp,
  actions,
  className,
}: {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  description: string;
  benefits?: string[];
  privacyNote?: string;
  status?: PermissionStatus;
  deniedHelp?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("rounded-xl bg-card p-6 shadow-card", className)}>
      <div className="flex items-start gap-4">
        <IconBadge icon={icon} tone={tone} size="lg" />
        <div className="flex-1">
          <h2 className="text-section-heading text-text-primary">{title}</h2>
          <p className="mt-1 text-body text-text-secondary">{description}</p>
        </div>
      </div>
      {benefits && benefits.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2.5">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-body text-text-primary">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              {b}
            </li>
          ))}
        </ul>
      )}
      {privacyNote && (
        <p className="mt-5 flex items-start gap-2 rounded-md bg-card-muted p-3 text-caption text-text-secondary">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          {privacyNote}
        </p>
      )}
      {status === "denied" && (
        <p role="status" className="mt-4 rounded-md bg-warning-soft p-3 text-caption font-medium text-text-primary">
          {deniedHelp ?? "Access is turned off. You can turn it on in your device settings."}
        </p>
      )}
      {status === "granted" && (
        <p role="status" className="mt-4 flex items-center gap-2 text-caption font-semibold text-success">
          <Check aria-hidden className="size-4" /> Connected
        </p>
      )}
      {status === "unavailable" && (
        <p role="status" className="mt-4 rounded-md bg-card-muted p-3 text-caption text-text-secondary">
          This isn&apos;t available on this device.
        </p>
      )}
      {actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
    </section>
  );
}
