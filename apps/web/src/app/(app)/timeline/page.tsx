import type { Metadata } from "next";
import { History } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Health Timeline" };

export default function Page() {
  return (
    <PlannedScreen
      title="Health Timeline"
      description="Everything that happened, in order, with its source."
      icon={History}
      tone="orange"
      phase="Phase 5"
      summary="A chronological timeline of measurements, check-ins, reports and plan activity arrives in Phase 5."
    />
  );
}
