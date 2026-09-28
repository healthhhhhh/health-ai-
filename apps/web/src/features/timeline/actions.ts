"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, errorMessage } from "@/lib/api/server";

export interface TimelineFormState {
  error?: string;
  ok?: boolean;
}

const TYPES = ["symptom", "note", "appointment"] as const;

export async function addTimelineEntry(_prev: TimelineFormState, form: FormData): Promise<TimelineFormState> {
  const eventType = String(form.get("eventType") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const details = String(form.get("details") ?? "").trim();
  const when = String(form.get("occurredAt") ?? "");
  if (!(TYPES as readonly string[]).includes(eventType)) return { error: "Choose what kind of entry this is." };
  if (!title) return { error: "Add a short title." };
  const occurredAt = when ? new Date(when) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return { error: "Enter a valid date and time." };
  if (eventType !== "appointment" && occurredAt.getTime() > Date.now() + 60_000) return { error: "Only appointments can be in the future." };
  try {
    await api("timeline", { method: "POST", json: { eventType, title: title.slice(0, 200), occurredAt: occurredAt.toISOString(), details: details ? details.slice(0, 1000) : undefined } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/timeline");
  revalidatePath("/home");
  return { ok: true };
}

export async function deleteTimelineEntry(id: string): Promise<{ error?: string }> {
  try {
    await api(`timeline/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/timeline");
  revalidatePath("/home");
  return {};
}
