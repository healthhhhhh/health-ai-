import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Status = "success" | "warning" | "error" | "info" | "neutral";

const styles: Record<Status, { className: string; icon: ReactNode }> = {
  success: { className: "bg-success-soft text-success", icon: <CircleCheck /> },
  warning: { className: "bg-warning-soft text-warning", icon: <TriangleAlert /> },
  error: { className: "bg-error-soft text-error", icon: <CircleAlert /> },
  info: { className: "bg-primary-soft text-primary", icon: <Info /> },
  neutral: { className: "bg-card-muted text-text-secondary ring-1 ring-separator", icon: null },
};

/** Status is never conveyed by color alone — every badge carries an icon and a label. */
export function StatusBadge({ status, children, showIcon = true, className }: { status: Status; children: ReactNode; showIcon?: boolean; className?: string }) {
  const s = styles[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3.5", s.className, className)}>
      {showIcon && s.icon}
      {children}
    </span>
  );
}
