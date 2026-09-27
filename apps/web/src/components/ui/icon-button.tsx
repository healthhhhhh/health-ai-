import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface IconButtonProps extends Omit<ComponentProps<"button">, "children"> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
  /** Shows a small red dot, e.g. unread notifications. */
  indicator?: boolean;
}

export function IconButton({ label, icon, indicator, className, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-10 items-center justify-center rounded-pill text-text-primary transition-colors hover:bg-card-muted [&_svg]:size-5",
        className,
      )}
      {...props}
    >
      {icon}
      {indicator && <span aria-hidden className="absolute top-2 right-2.5 size-2 rounded-full bg-error ring-2 ring-card" />}
    </button>
  );
}
