"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api/server";
import { clearSession } from "@/lib/api/session";

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
