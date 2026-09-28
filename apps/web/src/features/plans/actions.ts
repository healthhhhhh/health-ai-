"use server";

import type { PlanItemRecord, PlanRepeat } from "@healthmate/shared-types";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfile, updatePlan } from "@/lib/api/data";
import { errorMessage } from "@/lib/api/server";
import { dayIn, withCompletion } from "@/lib/plan";

export interface PlanFormState {
  error?: string;
  ok?: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  revalidatePath("/plans");
  revalidatePath("/home");
}

/**
 * Adds a plan item. For medications the instruction is stored exactly as
 * typed (only surrounding whitespace removed) and is required.
 */
export async function addPlanItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const kind = String(form.get("kind") ?? "task") as PlanItemRecord["kind"];
  const title = String(form.get("title") ?? "").trim();
  const notes = String(form.get("notes") ?? "").trim();
  const instruction = String(form.get("instruction") ?? "").trim();
  const time = String(form.get("time") ?? "09:00");
  const repeatType = String(form.get("repeat") ?? "daily");
  const days = form.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7);

  if (!["task", "habit", "medication"].includes(kind)) return { error: "Choose a type." };
  if (!title) return { error: kind === "medication" ? "Enter the medication name." : "Give it a name." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Choose a time." };
  if (kind === "medication" && !instruction) return { error: "Copy the instructions exactly as written on your prescription or label." };

  let repeat: PlanRepeat;
  try {
    const { profile } = await getProfile();
    const today = dayIn(new Date(), profile.timeZone);
    const onceDay = String(form.get("day") ?? today);
    if (repeatType === "weekdays") {
      if (days.length === 0) return { error: "Pick at least one day." };
      repeat = { type: "weekdays", days: [...new Set(days)].sort() };
    } else if (repeatType === "once") {
      if (!DAY.test(onceDay)) return { error: "Choose a date." };
      repeat = { type: "once", day: onceDay };
    } else {
      repeat = { type: "daily" };
    }
    const item: PlanItemRecord = {
      id: randomUUID(),
      title: title.slice(0, 120),
      notes: kind === "medication" ? null : notes.slice(0, 500) || null,
      kind,
      time,
      repeat,
      reminderEnabled: true,
      source: kind === "medication" && form.get("fromClinician") === "on" ? "clinician_provided" : "user_reported",
      instruction: kind === "medication" ? instruction.slice(0, 1000) : null,
      startDay: repeat.type === "once" ? repeat.day : today,
      endDay: null,
      createdAt: new Date().toISOString(),
    };
    await updatePlan((plan) => ({ items: [...plan.items, item], completions: plan.completions }));
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh();
  return { ok: Date.now() };
}

export async function removePlanItem(id: string): Promise<{ error?: string }> {
  try {
    await updatePlan((plan) => ({ items: plan.items.filter((i) => i.id !== id), completions: plan.completions.filter((c) => c.itemId !== id) }));
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh();
  return {};
}

export async function setCompleted(id: string, day: string, completed: boolean): Promise<{ error?: string }> {
  if (!DAY.test(day)) return { error: "Invalid day." };
  try {
    const { profile } = await getProfile();
    const today = dayIn(new Date(), profile.timeZone);
    if (completed && day > today) return { error: "Future days can't be ticked off yet." };
    await updatePlan((plan) => ({ items: plan.items, completions: withCompletion(plan.completions, id, day, completed, today) }));
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh();
  return {};
}
