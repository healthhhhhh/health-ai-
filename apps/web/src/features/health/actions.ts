"use server";

import type { MeasurementKind } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getProfile } from "@/lib/api/data";
import { api, errorMessage } from "@/lib/api/server";
import { dayIn } from "@/lib/plan";
import { READING_TYPES } from "./reading-types";

export interface ReadingState {
  error?: string;
  fieldErrors?: { value?: string; date?: string };
}

/** Saves a reading the person entered themselves (source: user_entered); it becomes part of that day's history. */
export async function addReading(_prev: ReadingState, form: FormData): Promise<ReadingState> {
  const kind = String(form.get("kind") ?? "") as MeasurementKind;
  const type = READING_TYPES.find((t) => t.kind === kind);
  if (!type) return { error: "Choose what you're recording." };
  const date = String(form.get("date") ?? "");
  const { profile } = await getProfile();
  const today = dayIn(new Date(), profile.timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { fieldErrors: { date: "Choose a date." } };
  if (date > today) return { fieldErrors: { date: "The date can't be in the future." } };

  let value: number;
  if (kind === "sleep") {
    const hours = Number(form.get("hours") || 0);
    const minutes = Number(form.get("minutes") || 0);
    value = Math.round(hours * 60 + minutes);
  } else {
    value = Number(String(form.get("value") ?? "").replace(",", "."));
  }
  if (!Number.isFinite(value) || value < type.min || value > type.max) {
    return { fieldErrors: { value: `Enter a value between ${type.format(type.min)} and ${type.format(type.max)}.` } };
  }
  // Today's reading is "now"; an earlier day is recorded at midday so it lands on that day.
  const recordedAt = date === today ? new Date().toISOString() : new Date(`${date}T12:00:00Z`).toISOString();
  try {
    await api("health-data/measurements", { method: "POST", json: { measurements: [{ kind, value, recordedAt, source: "user_entered" }] } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/health", "layout");
  redirect(`/health/history/${date}?added=${kind}`);
}
