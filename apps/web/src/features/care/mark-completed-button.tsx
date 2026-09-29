"use client";

import { CircleCheck } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setAppointmentStatus } from "./actions";

/** For a past appointment still marked scheduled. */
export function MarkCompletedButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await setAppointmentStatus(id, "completed");
          toast(result.error ? { tone: "error", title: "Couldn't update the appointment", description: result.error } : { tone: "success", title: "Marked as done" });
        })
      }
    >
      <CircleCheck aria-hidden /> Mark as done
    </Button>
  );
}
