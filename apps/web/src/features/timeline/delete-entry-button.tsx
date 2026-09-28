"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteTimelineEntry } from "./actions";

export function DeleteEntryButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Delete entry: ${title}`}
      onClick={() => start(async () => void (await deleteTimelineEntry(id)))}
      className="rounded-md p-2 text-text-muted hover:bg-error-soft hover:text-error disabled:opacity-50"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  );
}
