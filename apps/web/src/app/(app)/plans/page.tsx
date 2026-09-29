import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddPlanItemForm, DayList } from "@/features/plans/plan-client";
import { PlanError } from "@/features/plans/plan-error";
import { PlanTabs } from "@/features/plans/plan-tabs";
import { getPlan, getProfile } from "@/lib/api/data";
import { ApiError } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { dayIn, tasksForDay } from "@/lib/plan";

export const metadata: Metadata = { title: "Medications & Tasks" };
export const dynamic = "force-dynamic";

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ day?: string; add?: string }> }) {
  const { day: requested, add } = await searchParams;
  const loaded = await Promise.all([getProfile(), getPlan()]).catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });
  if (loaded instanceof ApiError) {
    return (
      <>
        <PageHeader title="Medications & Tasks" description="Your plan — shared with the HealthMate iPhone app, which sends the reminders." />
        <PlanTabs current="/plans" />
        <PlanError error={loaded} retry="/plans" />
      </>
    );
  }
  const [health, plan] = loaded;
  const { profile } = health;
  // "Add a reminder" for a profile medication brings its name and instructions exactly as entered.
  const fromProfile = add?.startsWith("profile-") ? health.medications.find((m) => `profile-${m.id}` === add) : undefined;
  const initial = fromProfile
    ? { kind: "medication", title: fromProfile.name, instruction: fromProfile.instruction, fromClinician: fromProfile.source === "clinician_provided" }
    : add === "medication"
      ? { kind: "medication" }
      : undefined;
  const today = dayIn(new Date(), profile.timeZone);
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 3));
  const tasks = tasksForDay(plan, day);
  const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Medications & Tasks" description="Your plan — shared with the HealthMate iPhone app, which sends the reminders." />
      <PlanTabs current="/plans" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <Card as="section" aria-labelledby="day-heading">
          <nav aria-label="Day" className="mb-4 grid grid-cols-7 gap-1">
            {week.map((d) => (
              <Link
                key={d}
                href={`/plans?day=${d}`}
                aria-current={d === day ? "date" : undefined}
                className={cn(
                  "flex flex-col items-center rounded-md py-2 text-caption",
                  d === day ? "bg-primary-fill text-on-primary" : "text-text-secondary hover:bg-card-muted",
                  d === today && d !== day && "font-semibold text-primary",
                )}
              >
                <span>{label(d, { weekday: "short" })}</span>
                <span className="text-body font-semibold">{label(d, { day: "numeric" })}</span>
              </Link>
            ))}
          </nav>
          <h2 id="day-heading" className="text-card-title text-text-primary">
            {day === today ? "Today" : label(day, { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          {tasks.length === 0 ? (
            <EmptyState icon={<ListChecks />} title="Nothing planned" description="Add a task, habit or medication with the form." className="py-8" />
          ) : (
            <DayList key={day} tasks={tasks} day={day} canComplete={day <= today} />
          )}
          {day > today && tasks.length > 0 && <p className="mt-2 text-caption text-text-secondary">You can tick these off on the day.</p>}
        </Card>
        <Card as="section" id="add" aria-labelledby="add-heading" className="h-fit">
          <h2 id="add-heading" className="mb-4 text-card-title text-text-primary">
            Add to your plan
          </h2>
          <AddPlanItemForm key={add ?? "new"} today={today} initial={initial} />
        </Card>
      </div>
    </>
  );
}
