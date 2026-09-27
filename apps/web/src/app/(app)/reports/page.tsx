import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "Medical Reports" };

export default function Page() {
  return (
    <PlannedScreen
      title="Medical Reports"
      description="Upload reports and get plain-language explanations."
      icon={FileText}
      tone="red"
      phase="Phase 6"
      summary="Secure report upload, extraction and plain-language summaries arrive in Phase 6."
    />
  );
}
