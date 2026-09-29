"use client";

import type { PlanTask } from "@healthmate/shared-types";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskRow } from "@/components/ui/task-row";
import { sourceLabel } from "@/features/home/plan";
import { formatClockTime } from "@/lib/format";
import { addPlanItem, setCompleted, type PlanFormState } from "./actions";

export function DayList({ tasks, day, canComplete }: { tasks: PlanTask[]; day: string; canComplete: boolean }) {
  const [optimistic, apply] = useOptimistic(tasks, (state, u: { id: string; completed: boolean }) => state.map((t) => (t.id === u.id ? { ...t, completed: u.completed } : t)));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ul className="divide-y divide-separator">
        {optimistic.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <TaskRow
                title={t.title}
                detail={t.detail}
                sourceLabel={sourceLabel(t)}
                time={formatClockTime(t.scheduledTime)}
                completed={t.completed}
                disabled={!canComplete}
                onToggle={(completed) =>
                  start(async () => {
                    setError(null);
                    apply({ id: t.id, completed });
                    const res = await setCompleted(t.id, day, completed);
                    if (res.error) setError(res.error);
                  })
                }
                href={`/plans/${encodeURIComponent(t.id)}`}
              />
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-caption font-medium text-error">
          {error}
        </p>
      )}
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface PlanItemInitial {
  kind: string;
  title?: string;
  instruction?: string;
  fromClinician?: boolean;
}

export function AddPlanItemForm({ today, initial }: { today: string; initial?: PlanItemInitial }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(addPlanItem, {});
  const [kind, setKind] = useState(initial?.kind ?? "task");
  const [repeat, setRepeat] = useState("daily");
  return (
    <form action={action} key={state.ok} className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-caption font-semibold text-text-primary">Type</legend>
        {[
          ["task", "Task"],
          ["habit", "Habit"],
          ["medication", "Medication"],
        ].map(([value, label]) => (
          <label key={value} className="cursor-pointer rounded-pill bg-card-muted px-3 py-1.5 text-caption ring-1 ring-separator has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:checked]:ring-primary">
            <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value!)} className="sr-only" />
            {label}
          </label>
        ))}
      </fieldset>
      <Input label={kind === "medication" ? "Medication name" : "Name"} name="title" defaultValue={initial?.title} placeholder={kind === "medication" ? "e.g. Metformin" : "e.g. Evening walk"} maxLength={120} />
      {kind === "medication" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="plan-instruction" className="text-caption font-semibold text-text-primary">
            Instructions, exactly as written
          </label>
          <textarea id="plan-instruction" name="instruction" defaultValue={initial?.instruction} rows={2} maxLength={1000} aria-describedby="plan-instruction-hint" className="rounded-md bg-card px-3.5 py-2.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary" />
          <p id="plan-instruction-hint" className="text-caption text-text-secondary">
            Copy them from your prescription or label. HealthMate stores them word for word and never suggests changing a medication or dose.
          </p>
          <label className="flex items-center gap-2 text-caption text-text-primary">
            <input type="checkbox" name="fromClinician" defaultChecked={initial?.fromClinician ?? true} className="size-4" /> These are my clinician&apos;s instructions
          </label>
        </div>
      ) : (
        <Input label="Details (optional)" name="notes" placeholder="e.g. 30 minutes" maxLength={500} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Time" name="time" type="time" defaultValue="09:00" />
        <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-primary">
          Repeats
          <select name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className="h-11 rounded-md bg-card px-3 font-normal ring-1 ring-separator">
            <option value="daily">Every day</option>
            <option value="weekdays">On certain days</option>
            <option value="once">Once</option>
          </select>
        </label>
      </div>
      {repeat === "weekdays" && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-caption font-semibold text-text-primary">Days</legend>
          {WEEKDAYS.map((label, i) => (
            <label key={label} className="cursor-pointer rounded-pill bg-card-muted px-3 py-1.5 text-caption ring-1 ring-separator has-[:checked]:bg-primary-soft has-[:checked]:text-primary">
              <input type="checkbox" name="days" value={i + 1} className="sr-only" /> {label}
            </label>
          ))}
        </fieldset>
      )}
      {repeat === "once" && <Input label="Date" name="day" type="date" defaultValue={today} min={today} />}
      {state.error && (
        <p role="alert" className="text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-caption font-medium text-success">
          Added to your plan.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Add to plan"}
      </Button>
    </form>
  );
}
