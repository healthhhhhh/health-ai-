import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { PlannedScreen } from "@/components/layout/planned-screen";

export const metadata: Metadata = { title: "AI Chat" };

export default function Page() {
  return (
    <PlannedScreen
      title="AI Chat"
      description="Talk with your AI Health Assistant."
      icon={MessageCircle}
      tone="blue"
      phase="Phase 4"
      summary="Conversations with the AI Health Assistant — follow-up questions, symptom check-ins, attachments and voice — arrive in Phase 4, routed through the safety layer."
    />
  );
}
