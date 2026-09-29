"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { deleteTimelineEntry } from "./actions";

/** Deletes an entry the person added, after confirming. `redirectTo` leaves a detail page afterwards. */
export function DeleteEntryButton({ id, title, redirectTo, compact = true }: { id: string; title: string; redirectTo?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      {compact ? (
        <button
          type="button"
          aria-label={`Delete entry: ${title}`}
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-text-muted hover:bg-error-soft hover:text-error"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden /> Delete entry
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this entry?"
        description={`“${title}” will be removed from your timeline.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const res = await deleteTimelineEntry(id);
          if (res.error) toast({ tone: "error", title: "Couldn't delete it", description: res.error });
          else {
            toast({ tone: "success", title: "Entry deleted" });
            if (redirectTo) router.push(redirectTo);
          }
        }}
      />
    </>
  );
}
