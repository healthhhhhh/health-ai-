import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Health Dashboard" };

export default function Page() {
  return (
    <PlannedScreen
      title="Health Dashboard"
      description="Vitals, sleep, activity, weight and nutrition over time."
      icon={LayoutDashboard}
      tone="purple"
      phase="Phase 5"
      summary="Charts and trends for your vitals, sleep, activity, weight and nutrition arrive in Phase 5."
    />
  );
}
