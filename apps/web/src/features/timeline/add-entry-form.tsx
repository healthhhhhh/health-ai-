"use client";

import { escalationMessage, triage } from "@healthmate/safety";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EscalationCard } from "@/features/chat/escalation-card";
import { addTimelineEntry, type TimelineFormState } from "./actions";

/** Add a symptom, note or appointment. Emergencies are flagged as they're typed. */
export function AddEntryForm() {
  const [state, action, pending] = useActionState<TimelineFormState, FormData>(async (prev, form) => {
    // The browser's local time is converted to an instant here.
    const local = String(form.get("occurredAt") ?? "");
    if (local) form.set("occurredAt", new Date(local).toISOString());
    return addTimelineEntry(prev, form);
  }, {});
  const [type, setType] = useState("symptom");
  const [text, setText] = useState("");
  const escalation = useMemo(() => {
    const result = triage(text);
    return result.level === "emergency" || result.level === "urgent" ? escalationMessage(result) : null;
  }, [text]);

  return (
    <form action={action} key={state.ok ? "reset" : "form"} className="flex flex-col gap-4" onInput={(e) => {
      const form = e.currentTarget;
      setText(`${(form.elements.namedItem("title") as HTMLInputElement).value} ${(form.elements.namedItem("details") as HTMLTextAreaElement).value}`);
    }}>
      {escalation && <EscalationCard escalation={escalation} />}
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-caption font-semibold text-text-primary">Type</legend>
        {[
          ["symptom", "Symptom"],
          ["note", "Note"],
          ["appointment", "Appointment"],
        ].map(([value, label]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 rounded-pill bg-card-muted px-3 py-1.5 text-caption ring-1 ring-separator has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:checked]:ring-primary">
            <input type="radio" name="eventType" value={value} checked={type === value} onChange={() => setType(value!)} className="sr-only" />
            {label}
          </label>
        ))}
      </fieldset>
      <Input label="Title" name="title" required maxLength={200} placeholder={type === "symptom" ? "e.g. Headache, mild" : type === "appointment" ? "e.g. Dentist" : "e.g. Started a new routine"} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="details" className="text-caption font-semibold text-text-primary">
          Details (optional)
        </label>
        <textarea id="details" name="details" maxLength={1000} rows={3} className="rounded-md bg-card px-3.5 py-2.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <Input label="When" name="occurredAt" type="datetime-local" hint={type === "appointment" ? "Appointments can be in the future." : "Leave empty for now."} />
      {state.error && (
        <p role="alert" className="text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-caption font-medium text-success">
          Added to your timeline.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Add to timeline"}
      </Button>
    </form>
  );
}
