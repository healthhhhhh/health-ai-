import type { Metadata } from "next";
import { ArrowLeft, Bell, BellOff, CalendarDays, Clock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SourceBadge } from "@/components/ui/content-labels";
import { Disclaimer } from "@/components/ui/disclaimer";
import { PlanItemActions } from "@/features/plans/plan-item-actions";
import { getPlan, getProfile } from "@/lib/api/data";
import { cn } from "@/lib/cn";
import { formatClockTime } from "@/lib/format";
import { dayIn, describeRepeat, itemHistory, occurs } from "@/lib/plan";

export const metadata: Metadata = { title: "Plan item" };
export const dynamic = "force-dynamic";

const KIND = { medication: "Medication", task: "Task", habit: "Habit" } as const;
const HISTORY = {
  done: { label: "Done", className: "bg-success-soft text-success ring-1 ring-success" },
  missed: { label: "Not done", className: "bg-card text-text-secondary ring-1 ring-separator" },
  due: { label: "Due today", className: "bg-primary-soft text-primary ring-1 ring-primary" },
  not_scheduled: { label: "Not scheduled", className: "bg-card-muted text-text-secondary" },
} as const;

/** One task, habit or medication: instructions exactly as entered, schedule, and the last 7 days. */
export default async function PlanItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ profile }, plan] = await Promise.all([getProfile(), getPlan()]);
  const item = plan.items.find((i) => i.id === id);
  if (!item) notFound();
  const today = dayIn(new Date(), profile.timeZone);
  const history = itemHistory(plan, item, today);
  const scheduled = history.filter((h) => h.status !== "not_scheduled" && h.status !== "due");
  const done = scheduled.filter((h) => h.status === "done").length;
  const isMedication = item.kind === "medication";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/plans" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> My Plan
      </Link>
      <div>
        <p className="text-caption font-semibold text-text-secondary">{KIND[item.kind]}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-heading text-text-primary">{item.title}</h1>
          <SourceBadge source={item.source} />
        </div>
      </div>

      {isMedication && (
        <Card as="section" aria-labelledby="instructions">
          <h2 id="instructions" className="text-caption font-semibold text-text-secondary">
            Instructions, exactly as entered
          </h2>
          <p className="mt-2 text-section-heading text-text-primary">{item.instruction ?? "No instructions saved"}</p>
          <p className="mt-3 text-caption text-text-secondary">
            HealthMate shows these word for word and never changes them. Check the label or ask your pharmacist or clinician if anything is unclear.
          </p>
        </Card>
      )}

      <Card as="section" aria-label="Schedule" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <p className="flex items-start gap-3 text-body text-text-primary">
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <span className="block text-caption text-text-secondary">Time</span>
            {formatClockTime(item.time)}
          </span>
        </p>
        <p className="flex items-start gap-3 text-body text-text-primary">
          <CalendarDays aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <span className="block text-caption text-text-secondary">Repeats</span>
            {describeRepeat(item.repeat)}
          </span>
        </p>
        <p className="flex items-start gap-3 text-body text-text-primary">
          {item.reminderEnabled ? <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" /> : <BellOff aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />}
          <span>
            <span className="block text-caption text-text-secondary">Reminder</span>
            {item.reminderEnabled ? "On (sent by the iPhone app)" : "Off"}
          </span>
        </p>
      </Card>

      {item.notes && (
        <Card as="section" aria-labelledby="notes">
          <h2 id="notes" className="text-caption font-semibold text-text-secondary">
            Notes
          </h2>
          <p className="mt-1 text-body whitespace-pre-line text-text-primary">{item.notes}</p>
        </Card>
      )}

      <Card as="section" aria-labelledby="history">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history" className="text-card-title text-text-primary">
            Last 7 days
          </h2>
          {scheduled.length > 0 && (
            <p className="text-caption font-semibold text-text-secondary">
              {done} of {scheduled.length} done
            </p>
          )}
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-2">
          {history.map((h) => {
            const date = new Date(`${h.day}T12:00:00Z`);
            return (
              <li key={h.day} className="flex flex-col items-center gap-1.5">
                <span className="text-xs text-text-secondary">{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
                <span className={cn("flex size-9 items-center justify-center rounded-full text-caption font-semibold tabular-nums", HISTORY[h.status].className)}>
                  {date.getUTCDate()}
                </span>
                <span className="sr-only">
                  {date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}: {HISTORY[h.status].label}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary" aria-hidden>
          {(["done", "missed", "due", "not_scheduled"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("size-3 rounded-full", HISTORY[s].className)} /> {HISTORY[s].label}
            </span>
          ))}
        </p>
      </Card>

      <PlanItemActions
        id={item.id}
        title={item.title}
        today={today}
        scheduledToday={occurs(item, today)}
        doneToday={history.at(-1)?.status === "done"}
        isMedication={isMedication}
      />
      {isMedication && <Disclaimer>Never start, stop or change a medication or dose without talking to your clinician.</Disclaimer>}
    </div>
  );
}
