import type { Metadata } from "next";
import { Stethoscope } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Doctor Consultation" };

export default function Page() {
  return (
    <PlannedScreen
      title="Doctor Consultation"
      description="Find care and manage appointments."
      icon={Stethoscope}
      tone="teal"
      phase="a later phase"
      summary="Care discovery and appointment management with real clinicians are planned after the MVP."
    />
  );
}
