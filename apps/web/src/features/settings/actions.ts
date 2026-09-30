"use server";

import type { NotificationPreferences } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api/server";
import { ACCESS_COOKIE, clearSession } from "@/lib/api/session";
import { DISPLAY_COOKIE, parseDisplayPrefs, type DisplayPrefs } from "@/lib/display-prefs";

export interface DeleteState {
  error?: string;
}

export async function deleteAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const password = String(form.get("password") ?? "");
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm you understand this can't be undone." };
  if (!password) return { error: "Enter your password." };
  try {
    await api("me/delete", { method: "POST", json: { password } });
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof ApiError && error.status === 401 ? "That password isn't right." : errorMessage(error) };
  }
  clearSession(await cookies());
  redirect("/?deleted=1");
}

/** Saves appearance and units for this browser, and the units with the account when signed in. */
export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const clean = parseDisplayPrefs(encodeURIComponent(JSON.stringify(prefs)));
  const jar = await cookies();
  jar.set(DISPLAY_COOKIE, encodeURIComponent(JSON.stringify(clean)), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  if (jar.get(ACCESS_COOKIE)?.value) {
    // Best effort: the browser's choice is what's shown either way.
    await api("me/profile", { method: "PATCH", json: { unitSystem: clean.units } }).catch((error) => unstable_rethrow(error));
  }
  revalidatePath("/", "layout");
}

export interface NotificationState {
  error?: string;
  saved?: boolean;
}

/** Which reminders and alerts to send, and how much they show on the lock screen. */
export async function saveNotificationPreferences(_prev: NotificationState, form: FormData): Promise<NotificationState> {
  const on = (k: string) => form.get(k) === "on";
  const time = (k: string, fallback: string) => {
    const v = String(form.get(k) ?? "");
    return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
  };
  const prefs: NotificationPreferences = {
    medication: on("medication"),
    task: on("task"),
    appointment: on("appointment"),
    report: on("report"),
    insight: on("insight"),
    account: true,
    showDetails: on("showDetails"),
    quietHours: { enabled: on("quietEnabled"), start: time("quietStart", "22:00"), end: time("quietEnd", "07:00") },
  };
  try {
    await api("me/notification-preferences", { method: "PUT", json: prefs });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return { error: "Notification settings aren't available on this server yet." };
    return { error: errorMessage(error) };
  }
  revalidatePath("/settings/notifications");
  return { saved: true };
}
