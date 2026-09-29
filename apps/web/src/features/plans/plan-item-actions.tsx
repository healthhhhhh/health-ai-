"use client";

import { Check, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { removePlanItem, setCompleted } from "./actions";

/** Tick today off (or undo) and remove the item, with confirmation. */
export function PlanItemActions({ id, title, today, scheduledToday, doneToday, isMedication }: { id: string; title: string; today: string; scheduledToday: boolean; doneToday: boolean; isMedication: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-3">
      {scheduledToday && (
        <Button
          variant={doneToday ? "secondary" : "primary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setCompleted(id, today, !doneToday);
              if (result.error) toast({ tone: "error", title: "Couldn't update", description: result.error });
              else toast({ tone: "success", title: doneToday ? "Marked as not done" : isMedication ? "Marked as taken today" : "Done for today" });
            })
          }
        >
          {doneToday ? <Undo2 aria-hidden /> : <Check aria-hidden />}
          {doneToday ? "Undo today" : isMedication ? "Mark as taken today" : "Mark as done today"}
        </Button>
      )}
      <Button variant="ghost" onClick={() => setConfirm(true)} disabled={pending}>
        <Trash2 aria-hidden /> Remove from plan
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Remove “${title}”?`}
        description={
          isMedication
            ? "This removes the reminder and its history from your plan. It doesn't change your prescription — talk to your clinician before stopping or changing a medication."
            : "This removes it and its history from your plan."
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const result = await removePlanItem(id);
          if (result.error) toast({ tone: "error", title: "Couldn't remove it", description: result.error });
          else {
            toast({ tone: "success", title: "Removed from your plan" });
            router.push("/plans");
          }
        }}
      />
    </div>
  );
}
