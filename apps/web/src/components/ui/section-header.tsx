import Link from "next/link";
import { cn } from "@/lib/cn";

export function SectionHeader({ title, actionLabel, actionHref, className, id }: { title: string; actionLabel?: string; actionHref?: string; className?: string; id?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between", className)}>
      <h2 id={id} className="text-section-heading text-text-primary">
        {title}
      </h2>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="text-caption font-semibold text-primary hover:underline underline-offset-4">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
