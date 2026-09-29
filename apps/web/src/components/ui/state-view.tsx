import { CircleCheck, CloudOff, Inbox, Loader2, LockKeyhole, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

export type ViewState = "loading" | "processing" | "empty" | "error" | "offline" | "permission" | "success";

const defaults: Record<ViewState, { icon: ReactNode; tone: Tone; title: string; description: string }> = {
  loading: { icon: <Loader2 />, tone: "blue", title: "Loading…", description: "This usually takes a moment." },
  processing: { icon: <RefreshCw />, tone: "blue", title: "Working on it…", description: "You can leave this page — we'll keep going." },
  empty: { icon: <Inbox />, tone: "blue", title: "Nothing here yet", description: "When you add something, it will appear here." },
  error: { icon: <TriangleAlert />, tone: "orange", title: "Something went wrong", description: "We couldn't load this. Please try again." },
  offline: { icon: <CloudOff />, tone: "orange", title: "You're offline", description: "Check your connection. We'll show your information again as soon as you're back online." },
  permission: { icon: <LockKeyhole />, tone: "purple", title: "Access is turned off", description: "Turn access on to use this feature. You can change it at any time." },
  success: { icon: <CircleCheck />, tone: "green", title: "All done", description: "Your changes were saved." },
};

/**
 * One component for every non-content state of a screen or section, so they
 * look and behave the same everywhere. Errors are announced (role=alert);
 * loading and processing are polite status updates.
 */
export function StateView({
  state,
  title,
  description,
  icon,
  tone,
  action,
  compact = false,
  className,
  children,
}: {
  state: ViewState;
  title?: string;
  description?: string;
  icon?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const d = defaults[state];
  const spinning = state === "loading" || state === "processing";
  return (
    <div
      role={state === "error" || state === "offline" ? "alert" : "status"}
      className={cn("flex flex-col items-center text-center", compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12", className)}
    >
      <IconBadge icon={icon ?? d.icon} tone={tone ?? d.tone} size={compact ? "md" : "lg"} className={spinning ? "[&_svg]:motion-safe:animate-spin" : undefined} />
      <h2 className={cn("text-text-primary", compact ? "text-card-title" : "text-section-heading")}>{title ?? d.title}</h2>
      <p className="max-w-md text-body text-text-secondary">{description ?? d.description}</p>
      {children}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
