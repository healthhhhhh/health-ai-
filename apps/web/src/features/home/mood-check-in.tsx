"use client";

import type { Mood } from "@healthmate/shared-types";
import { useState, useTransition } from "react";
import { recordMoodAction } from "@/app/(app)/home/actions";
import { Card } from "@/components/ui/card";
import { MoodSelector } from "@/components/ui/mood-selector";
import { cn } from "@/lib/cn";

const FOLLOW_UP: Record<Mood, string> = {
  great: "Glad to hear it! Keep it up.",
  good: "Nice. Your check-in has been saved.",
  okay: "Thanks for checking in.",
  low: "Sorry you're feeling low. Want to talk it through?",
  unwell: "Sorry you're unwell. Tell the assistant what's going on — if symptoms are severe, contact a doctor or emergency services.",
};

export function MoodCheckIn({ initialMood, className }: { initialMood?: Mood; className?: string }) {
  const [mood, setMood] = useState<Mood | undefined>(initialMood);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: Mood) => {
    const previous = mood;
    setMood(next);
    setError(null);
    startTransition(async () => {
      const result = await recordMoodAction(next).catch(() => ({ error: "failed" }));
      if (result.error) {
        setMood(previous);
        setError("Couldn't save your check-in. Please try again.");
      }
    });
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <h2 className="text-card-title text-text-primary">How are you feeling today?</h2>
      <p className="mb-4 text-caption text-text-secondary">A quick daily check-in helps spot patterns over time.</p>
      <div className="xl:my-auto xl:py-2">
        <MoodSelector value={mood} onChange={choose} disabled={pending} />
      </div>
      <p aria-live="polite" className={cn("mt-3 min-h-5 text-caption", error ? "font-medium text-error" : "text-text-secondary")}>
        {error ?? (mood ? FOLLOW_UP[mood] : "")}
      </p>
    </Card>
  );
}
