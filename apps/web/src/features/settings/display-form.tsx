"use client";

import { useOptimistic, useTransition } from "react";
import type { DisplayPrefs } from "@/lib/display-prefs";
import { cn } from "@/lib/cn";
import { saveDisplayPrefs } from "./actions";

const THEMES = [
  ["system", "Match my device"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;
const UNITS = [
  ["metric", "Kilograms (kg)"],
  ["imperial", "Pounds (lb)"],
] as const;

/** Appearance and units for this browser. Saved as you choose. */
export function DisplayForm({ prefs }: { prefs: DisplayPrefs }) {
  const [value, setValue] = useOptimistic(prefs);
  const [pending, start] = useTransition();
  const choose = (next: DisplayPrefs) =>
    start(async () => {
      setValue(next);
      await saveDisplayPrefs(next);
    });
  return (
    <div className="flex flex-col gap-5">
      <Group label="Appearance" options={THEMES} value={value.theme} disabled={pending} onChange={(theme) => choose({ ...value, theme })} />
      <Group label="Weight" options={UNITS} value={value.units} disabled={pending} onChange={(units) => choose({ ...value, units })} />
      <p className="text-caption text-text-secondary">Changes how weight is shown and entered. Readings are stored the same way either way.</p>
    </div>
  );
}

function Group<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <fieldset>
      <legend className="mb-2 text-caption font-semibold text-text-primary">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <label
            key={id}
            className={cn(
              "cursor-pointer rounded-pill px-4 py-2 text-caption font-semibold ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
              value === id ? "bg-primary-soft text-primary ring-primary" : "bg-card text-text-secondary ring-separator hover:text-text-primary",
            )}
          >
            <input type="radio" name={label} value={id} checked={value === id} disabled={disabled} onChange={() => onChange(id)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
