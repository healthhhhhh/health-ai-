import { FileText, MessageCircle, Pill, RefreshCw, Stethoscope, Activity } from "lucide-react";
import type { ActivityKind } from "@healthmate/shared-types";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/tone";

export const ACTIVITY_META: Record<ActivityKind, { icon: ReactNode; tone: Tone }> = {
  report: { icon: <FileText />, tone: "red" },
  medication: { icon: <Pill />, tone: "orange" },
  chat: { icon: <MessageCircle />, tone: "blue" },
  sync: { icon: <RefreshCw />, tone: "purple" },
  symptom: { icon: <Stethoscope />, tone: "orange" },
  measurement: { icon: <Activity />, tone: "green" },
};
