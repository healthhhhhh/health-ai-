"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, errorMessage } from "@/lib/api/server";

type Result = { error?: string };

async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work();
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  // The bell's unread count is in the layout.
  revalidatePath("/", "layout");
  return {};
}

const valid = (id: string) => /^[\w-]{1,64}$/.test(id);

export async function setNotificationRead(id: string, read: boolean): Promise<Result> {
  if (!valid(id)) return { error: "Unknown notification." };
  return run(() => api(`notifications/${id}`, { method: "PATCH", json: { read } }));
}

export async function markAllNotificationsRead(): Promise<Result> {
  return run(() => api("notifications/read-all", { method: "POST" }));
}

export async function deleteNotification(id: string): Promise<Result> {
  if (!valid(id)) return { error: "Unknown notification." };
  return run(() => api(`notifications/${id}`, { method: "DELETE" }));
}
