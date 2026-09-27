import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Medications & Tasks" };

export default function Page() {
  return (
    <PlannedScreen
      title="Medications & Tasks"
      description="Your care plan, reminders and habits."
      icon={ListChecks}
      tone="green"
      phase="Phase 7"
      summary="Full plans, medication schedules from your clinician, reminders and habit tracking arrive in Phase 7."
    />
  );
}
