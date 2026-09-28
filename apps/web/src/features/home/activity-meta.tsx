import { Activity, CalendarDays, FileText, Image, MessageCircle, NotebookPen, Pill, RefreshCw, Stethoscope } from "lucide-react";
import type { ActivityKind } from "@healthmate/shared-types";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/tone";

export const ACTIVITY_META: Record<ActivityKind, { icon: ReactNode; tone: Tone }> = {
  report: { icon: <FileText />, tone: "red" },
  image: { icon: <Image />, tone: "purple" },
  medication: { icon: <Pill />, tone: "orange" },
  chat: { icon: <MessageCircle />, tone: "blue" },
  sync: { icon: <RefreshCw />, tone: "purple" },
  symptom: { icon: <Stethoscope />, tone: "orange" },
  measurement: { icon: <Activity />, tone: "green" },
  note: { icon: <NotebookPen />, tone: "blue" },
  appointment: { icon: <CalendarDays />, tone: "teal" },
};
