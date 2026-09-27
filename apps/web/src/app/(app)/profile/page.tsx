import type { Metadata } from "next";
import { User } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return (
    <PlannedScreen
      title="Profile"
      description="Your health profile and account."
      icon={User}
      tone="blue"
      phase="Phase 2"
      summary="Your health profile, conditions, allergies and account details arrive with authentication in Phase 2."
    />
  );
}
