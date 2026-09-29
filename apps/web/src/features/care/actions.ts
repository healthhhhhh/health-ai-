"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getProfile } from "@/lib/api/data";
import { api, errorMessage } from "@/lib/api/server";
import { APPOINTMENT_MODES, serializePrep, zonedIso, type PrepQuestion } from "@/lib/care";

const ID = /^[\w-]{1,64}$/;

function refresh(id?: string) {
  revalidatePath("/care", "layout");
  revalidatePath("/home");
  revalidatePath("/timeline");
  if (id) revalidatePath(`/care/appointments/${id}`);
}

/** Marks an appointment cancelled in HealthMate (it doesn't contact the clinic). */
export async function cancelAppointment(id: string): Promise<{ error?: string }> {
  return setAppointmentStatus(id, "cancelled");
}

export async function setAppointmentStatus(id: string, status: "scheduled" | "completed" | "cancelled"): Promise<{ error?: string }> {
  if (!ID.test(id)) return { error: "Unknown appointment." };
  try {
    await api(`care/appointments/${id}`, { method: "PATCH", json: { status } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh(id);
  return {};
}

export interface CareFormState {
  error?: string;
  fields?: Record<string, string>;
}

/** Adds or edits an appointment; times are entered in the person's own time zone. */
export async function saveAppointment(_prev: CareFormState, form: FormData): Promise<CareFormState> {
  const fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const id = fields.id ?? "";
  const title = (fields.title ?? "").trim();
  const day = fields.day ?? "";
  const time = fields.time ?? "";
  const duration = Number(fields.duration ?? "0");
  const mode = APPOINTMENT_MODES.some((m) => m.id === fields.mode) ? fields.mode : null;
  if (!title) return { error: "Give the appointment a name.", fields };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Choose a date and time.", fields };
  if (id && !ID.test(id)) return { error: "Unknown appointment.", fields };
  let saved = id;
  try {
    const { profile } = await getProfile();
    const startsAt = zonedIso(day, time, profile.timeZone);
    const json = {
      title: title.slice(0, 200),
      careProviderId: fields.careProviderId || null,
      startsAt,
      endsAt: duration > 0 ? new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString() : null,
      mode,
      location: (fields.location ?? "").trim().slice(0, 300) || null,
      notes: (fields.notes ?? "").trim().slice(0, 1000) || null,
    };
    if (id) await api(`care/appointments/${id}`, { method: "PATCH", json });
    else saved = (await api<{ id: string }>("care/appointments", { method: "POST", json })).id;
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error), fields };
  }
  refresh(saved);
  redirect(`/care/appointments/${saved}`);
}

/** Saves the prepare-questions checklist into the appointment's notes. */
export async function savePrep(id: string, notes: string, questions: PrepQuestion[]): Promise<{ error?: string }> {
  if (!ID.test(id)) return { error: "Unknown appointment." };
  const clean = questions.filter((q) => q.text.trim()).slice(0, 30).map((q) => ({ text: q.text.trim().slice(0, 200), done: q.done }));
  try {
    await api(`care/appointments/${id}`, { method: "PATCH", json: { notes: serializePrep(notes, clean)?.slice(0, 1000) ?? null } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh(id);
  return {};
}

/** Adds or edits someone in the person's care team. */
export async function saveProvider(_prev: CareFormState, form: FormData): Promise<CareFormState> {
  const fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const id = fields.id ?? "";
  const name = (fields.name ?? "").trim();
  if (!name) return { error: "Add a name.", fields };
  const website = (fields.website ?? "").trim();
  if (website && !/^https?:\/\/\S+\.\S+/.test(website)) return { error: "Enter the website as a full address, starting with https://", fields };
  if (id && !ID.test(id)) return { error: "Unknown provider.", fields };
  let saved = id;
  try {
    const json = {
      name: name.slice(0, 160),
      specialty: (fields.specialty ?? "").trim().slice(0, 120) || null,
      phone: (fields.phone ?? "").trim().slice(0, 40) || null,
      address: (fields.address ?? "").trim().slice(0, 300) || null,
      website: website.slice(0, 300) || null,
      notes: (fields.notes ?? "").trim().slice(0, 1000) || null,
    };
    if (id) await api(`care/providers/${id}`, { method: "PATCH", json });
    else saved = (await api<{ id: string }>("care/providers", { method: "POST", json })).id;
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error), fields };
  }
  refresh();
  redirect(`/care/team/${saved}`);
}

export async function removeProvider(id: string): Promise<{ error?: string }> {
  if (!ID.test(id)) return { error: "Unknown provider." };
  try {
    await api(`care/providers/${id}`, { method: "DELETE" });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  refresh();
  return {};
}
