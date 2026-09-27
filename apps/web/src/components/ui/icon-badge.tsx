import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toneClasses, type Tone } from "@/lib/tone";

const sizes = {
  sm: "size-8 [&_svg]:size-4",
  md: "size-11 [&_svg]:size-5",
  lg: "size-14 [&_svg]:size-6",
};

/** A pastel circle holding a line icon — the core icon treatment from the reference. */
export function IconBadge({ icon, tone = "blue", size = "md", className }: { icon: ReactNode; tone?: Tone; size?: keyof typeof sizes; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full", toneClasses[tone].soft, toneClasses[tone].fg, sizes[size], className)}>
      {icon}
    </span>
  );
}
