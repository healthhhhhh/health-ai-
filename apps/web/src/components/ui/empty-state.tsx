import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import type { Tone } from "@/lib/tone";

export function EmptyState({ icon, title, description, action, tone = "blue", className }: { icon: ReactNode; title: string; description: string; action?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <IconBadge icon={icon} tone={tone} size="lg" />
      <h2 className="text-section-heading text-text-primary">{title}</h2>
      <p className="max-w-md text-body text-text-secondary">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
