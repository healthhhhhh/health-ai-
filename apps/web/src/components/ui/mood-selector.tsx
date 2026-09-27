"use client";

import { Frown, Laugh, Meh, Smile, Thermometer } from "lucide-react";
import type { Mood } from "@healthmate/shared-types";
import { cn } from "@/lib/cn";

export const MOODS: { value: Mood; label: string; icon: typeof Smile; className: string }[] = [
  { value: "great", label: "Great", icon: Laugh, className: "text-success bg-success-soft" },
  { value: "good", label: "Good", icon: Smile, className: "text-teal bg-teal-soft" },
  { value: "okay", label: "Okay", icon: Meh, className: "text-primary bg-primary-soft" },
  { value: "low", label: "Low", icon: Frown, className: "text-warning bg-warning-soft" },
  { value: "unwell", label: "Unwell", icon: Thermometer, className: "text-error bg-error-soft" },
];

/** Daily check-in: "How are you feeling today?" as an accessible radio group. */
export function MoodSelector({ value, onChange, disabled }: { value?: Mood; onChange: (mood: Mood) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">How are you feeling today?</legend>
      <div className="grid grid-cols-5 gap-2">
        {MOODS.map(({ value: v, label, icon: Icon, className }) => {
          const selected = v === value;
          return (
            <label
              key={v}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-md py-2.5 text-xs font-semibold transition-[color,background-color,transform] duration-200 active:scale-95 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                selected ? cn(className, "scale-105 ring-2 ring-current") : "text-text-secondary hover:-translate-y-0.5 hover:bg-card-muted",
              )}
            >
              <input type="radio" name="mood" value={v} checked={selected} onChange={() => onChange(v)} className="sr-only" />
              <Icon key={selected ? "on" : "off"} aria-hidden className={cn("size-6", selected && "animate-pop")} />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
