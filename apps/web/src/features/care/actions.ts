"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, errorMessage } from "@/lib/api/server";

/** Marks an appointment cancelled in HealthMate (it doesn't contact the clinic). */
export async function cancelAppointment(id: string): Promise<{ error?: string }> {
  if (!/^[\w-]{1,64}$/.test(id)) return { error: "Unknown appointment." };
  try {
    await api(`care/appointments/${id}`, { method: "PATCH", json: { status: "cancelled" } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath(`/care/appointments/${id}`);
  revalidatePath("/home");
  return {};
}
