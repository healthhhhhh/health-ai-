"use client";

import type { CareProviderRecord } from "@healthmate/shared-types";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { APPOINTMENT_MODES } from "@/lib/care";
import { saveAppointment, type CareFormState } from "./actions";

export interface AppointmentFormValues {
  id?: string;
  title?: string;
  careProviderId?: string | null;
  day: string;
  time: string;
  duration?: number;
  mode?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** Add or edit an appointment in the person's own time zone. */
export function AppointmentForm({ values, providers, timeZone }: { values: AppointmentFormValues; providers: CareProviderRecord[]; timeZone: string }) {
  const [state, action, pending] = useActionState<CareFormState, FormData>(saveAppointment, {});
  const v = { ...values, ...state.fields } as Record<string, string | number | null | undefined>;
  const str = (k: string) => (v[k] == null ? "" : String(v[k]));
  return (
    <form action={action} className="flex flex-col gap-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Input label="What is it?" name="title" defaultValue={str("title")} placeholder="e.g. Annual check-up" maxLength={200} required />
      <Select
        label="With"
        name="careProviderId"
        defaultValue={str("careProviderId")}
        options={[{ value: "", label: "Not in my care team" }, ...providers.map((p) => ({ value: p.id, label: p.specialty ? `${p.name} · ${p.specialty}` : p.name }))]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Date" name="day" type="date" defaultValue={str("day")} required />
        <Input label="Time" name="time" type="time" defaultValue={str("time")} required />
        <Select
          label="Length"
          name="duration"
          defaultValue={str("duration") || "30"}
          options={[
            { value: "0", label: "Not sure" },
            ...[15, 20, 30, 45, 60, 90].map((m) => ({ value: String(m), label: `${m} min` })),
          ]}
        />
      </div>
      <p className="-mt-2 text-xs text-text-secondary">Times are in your time zone ({timeZone}).</p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-caption font-semibold text-text-primary">How</legend>
        {APPOINTMENT_MODES.map((m) => (
          <label key={m.id} className="cursor-pointer rounded-pill bg-card-muted px-3 py-1.5 text-caption ring-1 ring-separator has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:checked]:ring-primary has-[:focus-visible]:ring-2">
            <input type="radio" name="mode" value={m.id} defaultChecked={(str("mode") || "in_person") === m.id} className="sr-only" />
            {m.label}
          </label>
        ))}
      </fieldset>
      <Input label="Where (optional)" name="location" defaultValue={str("location")} placeholder="Clinic name or address, or the video link's app" maxLength={300} />
      <Textarea label="Notes (optional)" name="notes" defaultValue={str("notes")} rows={3} maxLength={1000} hint="Anything to remember. You can add questions to ask on the appointment page." />
      {state.error && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : values.id ? "Save changes" : "Add appointment"}
      </Button>
    </form>
  );
}
