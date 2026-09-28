"use server";

import type { Mood } from "@healthmate/shared-types";
import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getProfile, updatePlan } from "@/lib/api/data";
import { api, errorMessage } from "@/lib/api/server";
import { dayIn, withCompletion } from "@/lib/plan";

const MOODS: readonly Mood[] = ["great", "good", "okay", "low", "unwell"];

export async function setTaskCompletedAction(itemId: string, completed: boolean): Promise<{ error?: string }> {
  if (typeof itemId !== "string" || typeof completed !== "boolean") return { error: "Invalid input" };
  try {
    const { profile } = await getProfile();
    const today = dayIn(new Date(), profile.timeZone);
    await updatePlan((plan) => ({ items: plan.items, completions: withCompletion(plan.completions, itemId, today, completed, today) }));
    revalidatePath("/home");
    revalidatePath("/plans");
    return {};
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
}

export async function recordMoodAction(mood: Mood): Promise<{ error?: string }> {
  if (!MOODS.includes(mood)) return { error: "Invalid mood" };
  try {
    await api("check-ins/mood", { method: "POST", json: { mood } });
    revalidatePath("/home");
    return {};
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
}
