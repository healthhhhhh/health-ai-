import { FileText, HeartPulse, ListChecks, MessageCircle, type LucideIcon } from "lucide-react";
import type { Tone } from "./tone";

export interface OnboardingFeature {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
}

export interface HealthGoal {
  id: string;
  label: string;
  description: string;
}

/** What the person wants help with (onboarding, profile). Same ids on iOS (`HealthGoal`). */
export const HEALTH_GOALS: HealthGoal[] = [
  { id: "understand_reports", label: "Understand my reports", description: "Plain-language summaries of test results and letters" },
  { id: "track_symptoms", label: "Keep track of symptoms", description: "Notice patterns and share them with my clinician" },
  { id: "manage_medications", label: "Stay on top of medications", description: "Reminders with instructions exactly as prescribed" },
  { id: "sleep_better", label: "Sleep better", description: "Build a steady routine" },
  { id: "be_active", label: "Be more active", description: "Small, steady steps" },
  { id: "prepare_appointments", label: "Prepare for appointments", description: "Questions and notes ready to go" },
];

/** Shared copy with the iOS onboarding (apps/ios/.../OnboardingFeature.swift). */
export const ONBOARDING_FEATURES: OnboardingFeature[] = [
  { title: "AI Health Assistant", description: "Plain-language answers to health questions, any time", icon: MessageCircle, tone: "blue" },
  { title: "Track Your Health", description: "Sync with Apple Health & wearables", icon: HeartPulse, tone: "teal" },
  { title: "Understand Your Reports", description: "Upload reports for clear, simple explanations", icon: FileText, tone: "green" },
  { title: "Stay on Track", description: "Reminders for your care plan, water, habits & more", icon: ListChecks, tone: "purple" },
];
