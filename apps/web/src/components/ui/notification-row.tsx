import { Bell, CalendarClock, ChevronRight, FileText, ListChecks, Pill, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tone";
import { IconBadge } from "./icon-badge";

export type NotificationCategory = "medication" | "task" | "appointment" | "report" | "insight" | "account";

export const notificationCategories: Record<NotificationCategory, { label: string; icon: ReactNode; tone: Tone }> = {
  medication: { label: "Medication reminders", icon: <Pill />, tone: "blue" },
  task: { label: "Tasks & habits", icon: <ListChecks />, tone: "green" },
  appointment: { label: "Appointments", icon: <CalendarClock />, tone: "teal" },
  report: { label: "Reports & photos", icon: <FileText />, tone: "purple" },
  insight: { label: "Insights", icon: <Sparkles />, tone: "purple" },
  account: { label: "Account & security", icon: <ShieldCheck />, tone: "orange" },
};

/** One notification; unread ones are marked with a dot and bold text, not colour alone. */
export function NotificationRow({
  category,
  title,
  body,
  time,
  read,
  aiGenerated,
  href,
  className,
}: {
  category: NotificationCategory;
  title: string;
  body: string;
  time: string;
  read: boolean;
  aiGenerated?: boolean;
  href?: string | null;
  className?: string;
}) {
  const c = notificationCategories[category] ?? { icon: <Bell />, tone: "blue" as Tone };
  const content = (
    <>
      <IconBadge icon={c.icon} tone={c.tone} size="sm" className="mt-0.5 md:size-10 md:[&_svg]:size-5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex items-center gap-2">
          {!read && (
            <span className="size-2 shrink-0 rounded-full bg-primary-fill">
              <span className="sr-only">Unread: </span>
            </span>
          )}
          <span className={cn("text-body text-text-primary", read ? "font-medium" : "font-semibold")}>{title}</span>
        </span>
        <span className="text-caption text-text-secondary">{body}</span>
        <span className="text-xs text-text-muted">
          {time}
          {aiGenerated ? " · AI-generated" : ""}
        </span>
      </span>
      {href && <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />}
    </>
  );
  const base = cn("flex w-full items-start gap-3 px-5 py-4", !read && "bg-primary-soft/40", href && "transition-colors hover:bg-card-muted", className);
  return href ? (
    <Link href={href} className={base}>
      {content}
    </Link>
  ) : (
    <div className={base}>{content}</div>
  );
}
