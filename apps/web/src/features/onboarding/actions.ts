"use server";

import type { ConsentKind, NotificationPreferences } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api/server";
import { HEALTH_GOALS } from "@/lib/onboarding";

export interface OnboardingInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  goals: string[];
  conditions: string[];
  allergies: string[];
  medications: { name: string; instruction: string }[];
  consents: Record<ConsentKind, boolean>;
  reminders: Pick<NotificationPreferences, "medication" | "task" | "appointment" | "showDetails">;
}

const SEXES = ["female", "male", "intersex", "prefer_not_to_say"];
const CONSENTS: ConsentKind[] = ["ai_processing", "document_processing", "health_data_sync", "voice"];

/** Server-side checks for the wizard; the same rules the step UI shows inline. */
export async function validateOnboarding(input: OnboardingInput): Promise<string | null> {
  if (!input.firstName.trim()) return "Enter your first name.";
  if (input.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) return "Enter your date of birth as a full date.";
  if (input.dateOfBirth && new Date(input.dateOfBirth) > new Date()) return "Your date of birth can't be in the future.";
  if (input.sex && !SEXES.includes(input.sex)) return "Choose an option for sex.";
  if (input.medications.some((m) => !m.name.trim() || !m.instruction.trim())) return "Each medication needs a name and its instructions exactly as written.";
  return null;
}

/**
 * Saves everything chosen during onboarding, then marks it complete. Health
 * details are stored as "you added" (user_reported), never as confirmed by a clinician.
 */
export async function completeOnboarding(input: OnboardingInput): Promise<{ error: string } | undefined> {
  const invalid = await validateOnboarding(input);
  if (invalid) return { error: invalid };
  const goals = input.goals.filter((g) => HEALTH_GOALS.some((x) => x.id === g));
  try {
    await api("me/profile", {
      method: "PATCH",
      json: {
        firstName: input.firstName.trim().slice(0, 80),
        lastName: input.lastName.trim().slice(0, 80),
        dateOfBirth: input.dateOfBirth || null,
        sex: input.sex || null,
        goals,
      },
    });
    for (const name of input.conditions.map((c) => c.trim()).filter(Boolean)) {
      await api("me/conditions", { method: "POST", json: { name: name.slice(0, 120), source: "user_reported" } });
    }
    for (const substance of input.allergies.map((a) => a.trim()).filter(Boolean)) {
      await api("me/allergies", { method: "POST", json: { substance: substance.slice(0, 120), source: "user_reported" } });
    }
    for (const m of input.medications) {
      // The instruction is kept word for word; only surrounding whitespace is removed.
      await api("me/medications", { method: "POST", json: { name: m.name.trim().slice(0, 120), instruction: m.instruction.trim().slice(0, 500), source: "user_reported" } });
    }
    for (const kind of CONSENTS) {
      await api("me/consents", { method: "POST", json: { kind, granted: Boolean(input.consents[kind]) } });
    }
    await optional(async () => {
      const current = await api<NotificationPreferences>("notification-preferences");
      await api("notification-preferences", { method: "PUT", json: { ...current, ...input.reminders } });
    });
    await optional(() => api("me/onboarding", { method: "POST" }));
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/", "layout");
  redirect("/home?welcome=1");
}

/** Endpoints the Phase 1 UI uses that an older API server may not have yet. */
async function optional(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 404 || error.status === 501))) throw error;
  }
}
