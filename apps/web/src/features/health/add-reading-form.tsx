"use client";

import type { MeasurementKind } from "@healthmate/shared-types";
import { AlertCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { toDisplay, unitFor, type DisplayPrefs } from "@/lib/display-prefs";
import { addReading, type ReadingState } from "./actions";
import { READING_TYPES } from "./reading-types";

export function AddReadingForm({ today, initialKind, units = "metric" }: { today: string; initialKind?: MeasurementKind; units?: DisplayPrefs["units"] }) {
  const [state, action, pending] = useActionState<ReadingState, FormData>(addReading, {});
  const [kind, setKind] = useState<MeasurementKind>(READING_TYPES.some((t) => t.kind === initialKind) ? initialKind! : "weight");
  const type = READING_TYPES.find((t) => t.kind === kind)!;
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-caption font-semibold text-text-primary">What are you recording?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {READING_TYPES.map((t) => (
            <label
              key={t.kind}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-md px-3 py-2.5 text-caption font-semibold ring-1 transition-colors",
                kind === t.kind ? "bg-primary-soft text-primary ring-2 ring-primary" : "bg-card text-text-secondary ring-separator hover:bg-card-muted",
              )}
            >
              <input type="radio" name="kind" value={t.kind} checked={kind === t.kind} onChange={() => setKind(t.kind)} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "sleep" ? (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Hours" name="hours" type="number" inputMode="numeric" min={0} max={24} defaultValue={7} error={state.fieldErrors?.value} />
          <Input label="Minutes" name="minutes" type="number" inputMode="numeric" min={0} max={59} defaultValue={30} />
        </div>
      ) : (
        <Input
          key={kind}
          label={`${type.label} (${unitFor(kind, units, type.unit)})`}
          name="value"
          type="number"
          inputMode="decimal"
          step={type.step}
          min={Math.floor(toDisplay(kind, type.min, units))}
          max={Math.ceil(toDisplay(kind, type.max, units))}
          error={state.fieldErrors?.value}
        />
      )}
      <Input label="Date" name="date" type="date" defaultValue={today} max={today} error={state.fieldErrors?.date} />
      {state.error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save reading"}
      </Button>
    </form>
  );
}
