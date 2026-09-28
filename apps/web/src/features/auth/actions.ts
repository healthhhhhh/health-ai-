"use server";

import type { AuthResponse } from "@healthmate/shared-types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiBaseUrl } from "@/lib/api/config";
import { ApiError, errorMessage, publicApi } from "@/lib/api/server";
import { clearSession, REFRESH_COOKIE, writeSession } from "@/lib/api/session";
import { validateSignIn, type SignInErrors } from "./validation";

export interface AuthFormState {
  mode: "sign-in" | "sign-up";
  errors: SignInErrors & { firstName?: string };
  message?: string;
  values?: { email: string; firstName: string };
}

/** Only same-site paths, so `?next=` can't redirect somewhere else. */
function safeNext(next: FormDataEntryValue | null) {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/home";
}

export async function authenticate(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const mode = form.get("mode") === "sign-up" ? "sign-up" : "sign-in";
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const firstName = String(form.get("firstName") ?? "").trim();
  const timeZone = String(form.get("timeZone") ?? "UTC").slice(0, 64) || "UTC";

  const errors: AuthFormState["errors"] = validateSignIn({ email, password });
  if (mode === "sign-up" && !firstName) errors.firstName = "Enter your first name.";
  if (Object.keys(errors).length) return { mode, errors, values: { email, firstName } };

  let auth: AuthResponse;
  try {
    auth =
      mode === "sign-up"
        ? await publicApi<AuthResponse>("auth/register", { method: "POST", json: { email, password, firstName, lastName: "", timeZone } })
        : await publicApi<AuthResponse>("auth/login", { method: "POST", json: { email, password } });
  } catch (error) {
    const message = error instanceof ApiError && error.status === 409 ? "An account with this email already exists. Sign in instead." : errorMessage(error);
    return { mode, errors: {}, message, values: { email, firstName } };
  }
  writeSession(await cookies(), auth);
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Best effort: revoke the session server-side; always clear it here.
    await fetch(`${apiBaseUrl()}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  clearSession(jar);
  redirect("/sign-in");
}
