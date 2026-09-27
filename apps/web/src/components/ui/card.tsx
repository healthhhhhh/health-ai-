import type { ComponentProps, ElementType } from "react";
import { cn } from "@/lib/cn";

type CardProps<T extends ElementType> = { as?: T; padded?: boolean } & ComponentProps<T>;

export function Card<T extends ElementType = "div">({ as, padded = true, className, ...props }: CardProps<T>) {
  const Component = as ?? "div";
  return <Component className={cn("rounded-lg bg-card shadow-card", padded && "p-5", className)} {...props} />;
}

export function CardHeader({ title, action, className, headingLevel = 2 }: { title: string; action?: React.ReactNode; className?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)}>
      <Heading className="text-card-title text-text-primary">{title}</Heading>
      {action}
    </div>
  );
}
