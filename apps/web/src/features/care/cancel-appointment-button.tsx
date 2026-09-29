"use client";

import { CalendarX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cancelAppointment } from "./actions";

export function CancelAppointmentButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <CalendarX aria-hidden /> Mark as cancelled
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Mark “${title}” as cancelled?`}
        description="This only updates HealthMate and stops its reminders. It doesn't contact the clinic — call them to cancel or rearrange."
        confirmLabel="Mark as cancelled"
        destructive
        onConfirm={async () => {
          const result = await cancelAppointment(id);
          toast(result.error ? { tone: "error", title: "Couldn't update the appointment", description: result.error } : { tone: "success", title: "Marked as cancelled" });
        }}
      />
    </>
  );
}
