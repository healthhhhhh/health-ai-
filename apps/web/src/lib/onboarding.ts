import { FileText, HeartPulse, ListChecks, MessageCircle, type LucideIcon } from "lucide-react";
import type { Tone } from "./tone";

export interface OnboardingFeature {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
}

/** Shared copy with the iOS onboarding (apps/ios/.../OnboardingFeature.swift). */
export const ONBOARDING_FEATURES: OnboardingFeature[] = [
  { title: "AI Health Assistant", description: "Plain-language answers to health questions, any time", icon: MessageCircle, tone: "blue" },
  { title: "Track Your Health", description: "Sync with Apple Health & wearables", icon: HeartPulse, tone: "teal" },
  { title: "Understand Your Reports", description: "Upload reports for clear, simple explanations", icon: FileText, tone: "green" },
  { title: "Stay on Track", description: "Reminders for your care plan, water, habits & more", icon: ListChecks, tone: "purple" },
];
