"use server";

import type { Mood } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { getDataClient } from "@/lib/data";

const MOODS: readonly Mood[] = ["great", "good", "okay", "low", "unwell"];

export async function setTaskCompletedAction(taskId: string, completed: boolean) {
  if (typeof taskId !== "string" || typeof completed !== "boolean") throw new Error("Invalid input");
  await getDataClient().setTaskCompleted(taskId, completed);
  revalidatePath("/home");
}

export async function recordMoodAction(mood: Mood) {
  if (!MOODS.includes(mood)) throw new Error("Invalid mood");
  await getDataClient().recordMood(mood);
  revalidatePath("/home");
}
