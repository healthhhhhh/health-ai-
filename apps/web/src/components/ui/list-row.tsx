import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** Right-hand value or badge. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Adds a chevron; on by default for links. */
  chevron?: boolean;
  unread?: boolean;
  className?: string;
}

/**
 * The standard row: icon badge, title, subtitle, trailing value and chevron.
 * Renders a link, a button or plain content depending on what's passed.
 */
export function ListRow({ title, subtitle, icon, tone = "blue", trailing, href, onClick, chevron, unread, className }: ListRowProps) {
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      {icon && <IconBadge icon={icon} tone={tone} size="sm" className="mt-0.5 md:size-10 md:[&_svg]:size-5" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex items-center gap-2 text-body font-semibold text-text-primary">
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary-fill">
              <span className="sr-only">Unread: </span>
            </span>
          )}
          <span className="min-w-0 truncate">{title}</span>
        </span>
        {subtitle && <span className="text-caption text-text-secondary">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-caption text-text-secondary">{trailing}</span>}
      {(chevron ?? Boolean(href)) && <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />}
    </>
  );
  const base = cn("flex w-full items-start gap-3 px-5 py-3.5", interactive && "transition-colors hover:bg-card-muted focus-visible:bg-card-muted", className);
  if (href) {
    return (
      <Link href={href} className={base}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}

/** A card of rows with separators, optionally titled. */
export function ListGroup({ title, action, children, className, footer }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-2", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-1">
          {title && <h2 className="text-card-title text-text-primary">{title}</h2>}
          {action}
        </div>
      )}
      <div className="flex flex-col divide-y divide-separator overflow-hidden rounded-lg bg-card shadow-card">{children}</div>
      {footer && <p className="px-1 text-caption text-text-secondary">{footer}</p>}
    </section>
  );
}
