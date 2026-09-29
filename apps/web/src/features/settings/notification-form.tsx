"use client";

import type { NotificationPreferences } from "@healthmate/shared-types";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveNotificationPreferences, type NotificationState } from "./actions";

const CATEGORIES = [
  ["medication", "Medication reminders", "At the times in your plan"],
  ["task", "Tasks and habits", "Reminders for items in your plan"],
  ["appointment", "Appointments", "The day before and on the day"],
  ["report", "Reports and photos", "When a summary is ready or a file couldn't be read"],
  ["insight", "Weekly insights", "A short look at your trends, labelled as AI-generated"],
] as const;

export function NotificationForm({ prefs }: { prefs: NotificationPreferences }) {
  const [state, action, pending] = useActionState<NotificationState, FormData>(saveNotificationPreferences, {});
  const [quiet, setQuiet] = useState(prefs.quietHours.enabled);
  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col divide-y divide-separator">
        <legend className="mb-1 text-card-title text-text-primary">What to send</legend>
        {CATEGORIES.map(([key, title, detail]) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 py-3">
            <input type="checkbox" name={key} defaultChecked={prefs[key]} className="mt-1 size-5 accent-[var(--color-primary-fill)]" />
            <span>
              <span className="block text-body font-semibold text-text-primary">{title}</span>
              <span className="text-caption text-text-secondary">{detail}</span>
            </span>
          </label>
        ))}
        <p className="py-3 text-caption text-text-secondary">Account and security messages (like password changes) are always sent.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-card-title text-text-primary">Privacy on the lock screen</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="showDetails" defaultChecked={prefs.showDetails} className="mt-1 size-5 accent-[var(--color-primary-fill)]" />
          <span>
            <span className="block text-body font-semibold text-text-primary">Show names and details</span>
            <span className="text-caption text-text-secondary">Off: notifications only say something is due, so nothing about your health appears on the lock screen.</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-card-title text-text-primary">Quiet hours</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="quietEnabled" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} className="mt-1 size-5 accent-[var(--color-primary-fill)]" />
          <span>
            <span className="block text-body font-semibold text-text-primary">Hold non-urgent notifications</span>
            <span className="text-caption text-text-secondary">Medication reminders you&apos;ve scheduled in these hours are still sent.</span>
          </span>
        </label>
        {quiet && (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <Input label="From" name="quietStart" type="time" defaultValue={prefs.quietHours.start} />
            <Input label="Until" name="quietEnd" type="time" defaultValue={prefs.quietHours.end} />
          </div>
        )}
        {!quiet && (
          <>
            <input type="hidden" name="quietStart" value={prefs.quietHours.start} />
            <input type="hidden" name="quietEnd" value={prefs.quietHours.end} />
          </>
        )}
      </fieldset>
      {state.error && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-caption font-medium text-success">
          Saved. The iPhone app uses these the next time it schedules reminders.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save notification settings"}
      </Button>
    </form>
  );
}
