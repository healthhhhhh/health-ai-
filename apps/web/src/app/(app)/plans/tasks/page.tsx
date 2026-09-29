import type { PlanTask } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { CircleCheck, ListChecks } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { PlanError } from "@/features/plans/plan-error";
import { PlanTabs } from "@/features/plans/plan-tabs";
import { getPlan, getProfile } from "@/lib/api/data";
import { ApiError } from "@/lib/api/server";
import { formatClockTime } from "@/lib/format";
import { dayIn, taskOverview, timeIn } from "@/lib/plan";

export const metadata: Metadata = { title: "All tasks" };
export const dynamic = "force-dynamic";

const KIND = { medication: "Medication", activity: "Habit", other: "Task" } as Record<string, string>;

/** Everything in the plan across days: due earlier today, later, done, coming up, and not done this week. */
export default async function PlanTasksPage() {
  const loaded = await Promise.all([getProfile(), getPlan()]).catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });
  const header = <PageHeader title="Medications & Tasks" description="Your plan — shared with the HealthMate iPhone app, which sends the reminders." />;
  if (loaded instanceof ApiError) {
    return (
      <>
        {header}
        <PlanTabs current="/plans/tasks" />
        <PlanError error={loaded} retry="/plans/tasks" />
      </>
    );
  }
  const [{ profile }, plan] = loaded;
  const now = new Date();
  const today = dayIn(now, profile.timeZone);
  const o = taskOverview(plan, today, timeIn(now, profile.timeZone));
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <>
      {header}
      <PlanTabs current="/plans/tasks" />
      {plan.items.length === 0 ? (
        <Card>
          <StateView
            state="empty"
            icon={<ListChecks />}
            title="Your plan is empty"
            description="Add a task, habit or medication and it will appear here across the week."
            action={
              <Link href="/plans" className="text-caption font-semibold text-primary hover:underline">
                Add to your plan
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="flex flex-col gap-6">
            <Section title="Today" empty={o.dueEarlier.length + o.laterToday.length + o.doneToday.length === 0 ? "Nothing planned for today." : undefined}>
              {o.dueEarlier.length === 0 && o.laterToday.length === 0 && o.doneToday.length > 0 && (
                <p className="mb-2 flex items-center gap-2 text-caption font-semibold text-success">
                  <CircleCheck aria-hidden className="size-4" /> Everything for today is done.
                </p>
              )}
              <TaskList tasks={o.dueEarlier} badge={["warning", "Time has passed"]} />
              <TaskList tasks={o.laterToday} badge={["neutral", "Later today"]} />
              <TaskList tasks={o.doneToday} badge={["success", "Done"]} />
            </Section>
            <Section title="Not done this week" empty={o.notDone.length === 0 ? "Nothing missed in the last 7 days." : undefined}>
              <ul className="divide-y divide-separator">
                {o.notDone.map(({ day, task }) => (
                  <li key={`${day}-${task.id}`}>
                    <Row task={task} meta={`${dayName(day)} · ${formatClockTime(task.scheduledTime)}`} href={`/plans?day=${day}`} />
                  </li>
                ))}
              </ul>
              {o.notDone.length > 0 && <p className="mt-2 text-caption text-text-secondary">You can still tick these off on their day if you did them.</p>}
            </Section>
          </div>
          <Section title="Coming up" empty={o.upcoming.length === 0 ? "Nothing planned for the next 6 days." : undefined}>
            {o.upcoming.map(({ day, tasks }) => (
              <div key={day} className="mb-4 last:mb-0">
                <h3 className="text-caption font-semibold text-text-secondary">{dayName(day)}</h3>
                <ul className="divide-y divide-separator">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <Row task={t} meta={formatClockTime(t.scheduledTime)} href={`/plans/${encodeURIComponent(t.id)}`} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  return (
    <Card as="section" aria-label={title}>
      <h2 className="mb-2 text-card-title text-text-primary">{title}</h2>
      {empty ? <p className="text-caption text-text-secondary">{empty}</p> : children}
    </Card>
  );
}

function TaskList({ tasks, badge }: { tasks: PlanTask[]; badge: ["warning" | "neutral" | "success", string] }) {
  if (tasks.length === 0) return null;
  return (
    <ul className="divide-y divide-separator">
      {tasks.map((t) => (
        <li key={t.id}>
          <Row task={t} meta={formatClockTime(t.scheduledTime)} href={`/plans/${encodeURIComponent(t.id)}`} badge={badge} />
        </li>
      ))}
    </ul>
  );
}

function Row({ task, meta, href, badge }: { task: PlanTask; meta: string; href: string; badge?: ["warning" | "neutral" | "success", string] }) {
  return (
    <Link href={href} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-card-muted">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-text-primary">{task.title}</p>
        <p className="truncate text-caption text-text-secondary">
          {KIND[task.category] ?? "Task"} · {meta}
        </p>
      </div>
      {badge && <StatusBadge status={badge[0]}>{badge[1]}</StatusBadge>}
    </Link>
  );
}
