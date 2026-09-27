import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Frame for a metric chart: label → headline value → context → chart. The chart
 * itself is passed as children (charting is built out in Phase 5).
 */
export function ChartCard({ title, icon, value, unit, context, href, children, className }: { title: string; icon?: ReactNode; value: string; unit?: string; context?: string; href?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("rounded-lg bg-card p-4 shadow-card", className)}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-caption font-semibold text-text-secondary [&_svg]:size-4">
          {icon}
          {title}
        </h3>
        {href && (
          <Link href={href} aria-label={`Open ${title}`} className="text-text-muted hover:text-primary">
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
      <p className="mt-2 text-metric text-text-primary">
        {value}
        {unit && <span className="ml-1 text-body font-medium text-text-secondary">{unit}</span>}
      </p>
      {context && <p className="text-caption text-text-secondary">{context}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
