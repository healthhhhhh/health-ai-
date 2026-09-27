import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PlannedScreen
      title="Settings"
      description="Privacy, consent, integrations and data controls."
      icon={Settings}
      tone="blue"
      phase="Phase 12"
      summary="Privacy controls, consent management, integrations and data export/delete arrive with production hardening."
    />
  );
}
