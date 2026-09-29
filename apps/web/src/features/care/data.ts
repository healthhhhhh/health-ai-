import type { AppointmentRecord, CareProviderRecord } from "@healthmate/shared-types";
import { getProfile } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";

/** The care team, all appointments and the time zone — or the error to show instead. */
export async function loadCare(): Promise<{ providers: CareProviderRecord[]; appointments: AppointmentRecord[]; timeZone: string } | ApiError> {
  try {
    const [{ profile }, providers, appointments] = await Promise.all([getProfile(), api<CareProviderRecord[]>("care/providers"), api<AppointmentRecord[]>("care/appointments?when=all")]);
    return { providers, appointments, timeZone: profile.timeZone };
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  }
}
