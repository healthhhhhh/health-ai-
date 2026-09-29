"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PREP_SUGGESTIONS, type PrepQuestion } from "@/lib/care";
import { savePrep } from "./actions";

/** Questions to ask at the appointment, ticked off during the visit. Saved with the appointment's notes. */
export function PrepChecklist({ id, notes, initial }: { id: string; notes: string; initial: PrepQuestion[] }) {
  const [questions, setQuestions] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const persist = (next: PrepQuestion[]) => {
    const previous = questions;
    setQuestions(next);
    setSaved(false);
    start(async () => {
      const result = await savePrep(id, notes, next);
      if (result.error) {
        setQuestions(previous);
        setError(result.error);
      } else {
        setError(null);
        setSaved(true);
      }
    });
  };
  const add = (text: string) => {
    const t = text.trim();
    if (!t || questions.some((q) => q.text === t)) return;
    persist([...questions, { text: t, done: false }]);
    setDraft("");
  };
  const unused = PREP_SUGGESTIONS.filter((s) => !questions.some((q) => q.text === s));

  return (
    <div className="flex flex-col gap-3">
      {questions.length === 0 ? (
        <p className="text-caption text-text-secondary">No questions yet. Add your own, or start from a suggestion below.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {questions.map((q, i) => (
            <li key={q.text} className="flex items-center gap-2">
              <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-body text-text-primary">
                <input type="checkbox" checked={q.done} disabled={pending} onChange={() => persist(questions.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} className="size-5 accent-[var(--color-primary-fill)]" />
                <span className={q.done ? "text-text-secondary line-through" : ""}>{q.text}</span>
              </label>
              <button type="button" disabled={pending} onClick={() => persist(questions.filter((_, j) => j !== i))} aria-label={`Remove question: ${q.text}`} className="rounded-full p-2 text-text-muted hover:bg-card-muted hover:text-text-primary">
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
        className="flex gap-2"
      >
        <label htmlFor={`prep-${id}`} className="sr-only">
          Add a question
        </label>
        <input id={`prep-${id}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Add a question" className="h-11 min-w-0 flex-1 rounded-md bg-card px-3 text-body ring-1 ring-separator focus:ring-2 focus:ring-primary focus:outline-none" />
        <Button type="submit" variant="secondary" disabled={pending || !draft.trim()}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
          {unused.map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => add(s)} className="rounded-pill bg-card-muted px-3 py-1.5 text-left text-caption text-text-primary ring-1 ring-separator hover:bg-primary-soft">
              + {s}
            </button>
          ))}
        </div>
      )}
      <p aria-live="polite" className="text-caption text-text-secondary empty:hidden">
        {error ? "" : saved ? "Saved." : ""}
      </p>
      {error && (
        <p role="alert" className="text-caption font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}
