import { ChevronRight, MapPin, Phone, Video } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { StatusBadge } from "./status-badge";

export type AppointmentMode = "in_person" | "video" | "phone";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";

const modeLabel: Record<AppointmentMode, { label: string; icon: React.ReactNode }> = {
  in_person: { label: "In person", icon: <MapPin /> },
  video: { label: "Video call", icon: <Video /> },
  phone: { label: "Phone call", icon: <Phone /> },
};

/** An appointment with a date tile, provider, time, mode and status. */
export function AppointmentCard({
  title,
  providerName,
  startsAt,
  timeZone,
  mode,
  location,
  status = "scheduled",
  href,
  className,
}: {
  title: string;
  providerName?: string | null;
  startsAt: string;
  timeZone: string;
  mode?: AppointmentMode | null;
  location?: string | null;
  status?: AppointmentStatus;
  href?: string;
  className?: string;
}) {
  const date = new Date(startsAt);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
  const content = (
    <>
      <span className={cn("flex w-14 shrink-0 flex-col items-center rounded-md py-2", status === "cancelled" ? "bg-card-muted text-text-muted" : "bg-primary-soft text-primary")}>
        <span className="text-xs font-semibold uppercase">{part({ month: "short" })}</span>
        <span className="text-section-heading leading-none tabular-nums">{part({ day: "numeric" })}</span>
        <span className="text-xs">{part({ weekday: "short" })}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-body font-semibold text-text-primary", status === "cancelled" && "line-through decoration-text-muted")}>{title}</span>
        {providerName && <span className="text-caption text-text-secondary">{providerName}</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-secondary">
          <span className="tabular-nums">{part({ hour: "numeric", minute: "2-digit" })}</span>
          {mode && (
            <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
              {modeLabel[mode].icon}
              {modeLabel[mode].label}
            </span>
          )}
          {location && mode === "in_person" && <span className="truncate">{location}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        {status === "cancelled" && <StatusBadge status="neutral">Cancelled</StatusBadge>}
        {status === "completed" && <StatusBadge status="success">Completed</StatusBadge>}
        {href && <ChevronRight aria-hidden className="size-4 text-text-muted" />}
      </span>
    </>
  );
  const base = cn("flex items-start gap-4 rounded-lg bg-card p-4 shadow-card", href && "lift", className);
  return href ? (
    <Link href={href} className={base}>
      {content}
    </Link>
  ) : (
    <div className={base}>{content}</div>
  );
}
