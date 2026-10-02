"use server";

import type { AccountSummary, AgeAssessmentResponse, AgeEligibility, ConsentKind } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { AGE_GUARD_COOKIE, AGE_GUARD_MAX_AGE } from "@/lib/age-guard";
import { api, ApiError, errorMessage } from "@/lib/api/server";

export interface OnboardingInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  /** Kept as they are (goals are chosen later in Profile). */
  goals: string[];
  consents: Record<ConsentKind, boolean>;
}

const SEXES = ["female", "male", "intersex", "prefer_not_to_say"];
const CONSENTS: ConsentKind[] = ["ai_processing", "document_processing", "health_data_sync", "voice"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Server-side checks for the wizard; the same rules the steps show inline. */
export async function validateOnboarding(input: OnboardingInput): Promise<string | null> {
  if (!input.firstName.trim()) return "Enter your first name.";
  if (!DAY.test(input.dateOfBirth)) return "Enter your date of birth.";
  if (input.sex && !SEXES.includes(input.sex)) return "Choose an option for sex.";
  return null;
}

/**
 * Sends the date of birth the person confirmed to the API, which decides whether
 * they can use HealthMate (the server is the only judge of age). Nothing else is
 * saved until the last step, so a person who can't use HealthMate leaves nothing behind.
 */
export async function confirmAge(dateOfBirth: string): Promise<{ eligibility: AgeEligibility } | { deviceBlocked: true } | { error: string }> {
  const jar = await cookies();
  // A restriction already happened in this browser: an account whose age isn't confirmed yet
  // can't try a date here (see lib/age-guard). Accounts the server already confirmed are unaffected.
  if (jar.get(AGE_GUARD_COOKIE)) {
    const account = await api<AccountSummary>("me/account").catch(() => null);
    if ((account?.ageEligibility ?? "age_required") !== "eligible") return { deviceBlocked: true };
  }
  if (!DAY.test(dateOfBirth)) return { error: "Enter your date of birth." };
  try {
    const result = await api<AgeAssessmentResponse>("me/age", { method: "POST", json: { dateOfBirth } });
    const eligibility = result.eligibility ?? "eligible";
    if (eligibility === "age_review" || eligibility === "age_not_eligible") {
      // Only that a restriction happened — never the date. Kept through sign-out.
      jar.set(AGE_GUARD_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: AGE_GUARD_MAX_AGE });
    }
    return { eligibility };
  } catch (error) {
    unstable_rethrow(error);
    // Servers without age assessment (older, or turned off) don't restrict anyone by age.
    if (error instanceof ApiError && (error.status === 404 || error.status === 501)) return { eligibility: "eligible" };
    return { error: errorMessage(error) };
  }
}

/** Saves the profile and privacy choices, then marks setup done. Runs only after the age check passed. */
export async function completeOnboarding(input: OnboardingInput): Promise<{ error: string } | undefined> {
  const invalid = await validateOnboarding(input);
  if (invalid) return { error: invalid };
  try {
    await api("me/profile", {
      method: "PATCH",
      json: {
        firstName: input.firstName.trim().slice(0, 80),
        lastName: input.lastName.trim().slice(0, 80),
        dateOfBirth: input.dateOfBirth,
        sex: input.sex || null,
        goals: input.goals,
      },
    });
    for (const kind of CONSENTS) {
      await api("me/consents", { method: "POST", json: { kind, granted: Boolean(input.consents[kind]) } });
    }
    await optional(() => api("me/onboarding", { method: "POST" }));
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/", "layout");
  redirect("/home?welcome=1");
}

/** Endpoints an older API server may not have yet. */
async function optional(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 404 || error.status === 501))) throw error;
  }
}
