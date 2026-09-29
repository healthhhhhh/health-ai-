"use client";

import type { TimelineEventRecord } from "@healthmate/shared-types";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { entryDetails } from "@/lib/timeline";
import { updateTimelineEntry, type TimelineFormState } from "./actions";

/** "YYYY-MM-DDTHH:mm" in the browser's time zone, for a datetime-local input. */
function localInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditEntryForm({ entry }: { entry: TimelineEventRecord }) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const [state, action, pending] = useActionState<TimelineFormState, FormData>(async (prev, form) => {
    const local = String(form.get("occurredAt") ?? "");
    if (local) form.set("occurredAt", new Date(local).toISOString());
    const result = await updateTimelineEntry(prev, form);
    if (result.ok) {
      setEditing(false);
      toast({ tone: "success", title: "Entry updated" });
    }
    return result;
  }, {});

  if (!editing) {
    return (
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit entry
      </Button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <input type="hidden" name="id" value={entry.id} />
      <Input label="Title" name="title" defaultValue={entry.title} maxLength={200} required />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-details" className="text-caption font-semibold text-text-primary">
          Details (optional)
        </label>
        <textarea
          id="edit-details"
          name="details"
          defaultValue={entryDetails(entry) ?? ""}
          maxLength={1000}
          rows={3}
          className="rounded-md bg-card px-3.5 py-2.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <Input label="When" name="occurredAt" type="datetime-local" defaultValue={localInput(entry.occurredAt)} />
      {state.error && (
        <p role="alert" className="text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
