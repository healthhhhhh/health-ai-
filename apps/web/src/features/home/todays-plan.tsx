"use client";

import type { PlanTask } from "@healthmate/shared-types";
import { ListChecks } from "lucide-react";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { setTaskCompletedAction } from "@/app/(app)/home/actions";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfettiBurst } from "@/components/ui/confetti-burst";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { TaskRow } from "@/components/ui/task-row";
import { cn } from "@/lib/cn";
import { formatClockTime } from "@/lib/format";
import Link from "next/link";
import { planProgress, sourceLabel } from "./plan";

export function TodaysPlan({ tasks, className }: { tasks: PlanTask[]; className?: string }) {
  const [optimistic, applyOptimistic] = useOptimistic(tasks, (state, update: { id: string; completed: boolean }) =>
    state.map((t) => (t.id === update.id ? { ...t, completed: update.completed } : t)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { done, total } = planProgress(optimistic);
  const [celebrations, setCelebrations] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const wasComplete = useRef(total > 0 && done === total);

  const toggle = (id: string, completed: boolean) => {
    setError(null);
    const nextDone = done + (completed ? 1 : -1);
    const nowComplete = total > 0 && nextDone === total;
    if (nowComplete && !wasComplete.current) {
      setCelebrations((c) => c + 1);
      setAnnouncement("Everything on today's plan is done. Nice work!");
    } else {
      setAnnouncement("");
    }
    wasComplete.current = nowComplete;
    startTransition(async () => {
      applyOptimistic({ id, completed });
      try {
        await setTaskCompletedAction(id, completed);
      } catch {
        setError("Couldn't update that task. Please try again.");
      }
    });
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title="Today's Plan"
        action={
          <Link href="/plans" className="text-caption font-semibold text-primary hover:underline underline-offset-4">
            View plan
          </Link>
        }
        className="mb-2"
      />
      {total === 0 ? (
        <EmptyState icon={<ListChecks />} title="Nothing planned today" description="Tasks from your care plan and habits you add will show up here." className="py-6" />
      ) : (
        <>
          <div className="relative flex items-center gap-2">
            <p className="text-caption font-semibold text-success">
              {done} of {total} completed
            </p>
            {done === total && (
              <span key={celebrations} className="animate-pop text-caption font-semibold text-success">
                🎉 All done!
              </span>
            )}
            <ConfettiBurst trigger={celebrations} />
          </div>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
          <ProgressBar value={done} max={total} tone="green" label="Today's plan progress" className="mt-2 mb-1" />
          <div className="divide-y divide-separator">
            {optimistic.map((t) => (
              <TaskRow
                key={t.id}
                title={t.title}
                detail={t.detail}
                sourceLabel={sourceLabel(t)}
                time={formatClockTime(t.scheduledTime)}
                completed={t.completed}
                onToggle={(c) => toggle(t.id, c)}
              />
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-caption font-medium text-error">
          {error}
        </p>
      )}
    </Card>
  );
}
