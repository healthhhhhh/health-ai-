"use server";

import type { AuthResponse, RegisterResponse } from "@healthmate/shared-types";
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
  /** Non-error status, e.g. "check your email". */
  notice?: string;
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

  let auth: RegisterResponse;
  try {
    auth =
      mode === "sign-up"
        ? await publicApi<RegisterResponse>("auth/register", { method: "POST", json: { email, password, firstName, lastName: "", timeZone } })
        : await publicApi<AuthResponse>("auth/login", { method: "POST", json: { email, password } });
  } catch (error) {
    const message = error instanceof ApiError && error.status === 409 ? "An account with this email already exists. Sign in instead." : errorMessage(error);
    return { mode, errors: {}, message, values: { email, firstName } };
  }
  if ("confirmationRequired" in auth) {
    return { mode: "sign-in", errors: {}, notice: `We've sent a confirmation link to ${email}. Open it, then sign in.`, values: { email, firstName } };
  }
  writeSession(await cookies(), auth);
  redirect(safeNext(form.get("next")));
}

export interface ResetState {
  sent?: boolean;
  done?: boolean;
  error?: string;
}

/** Always reports success for a valid email, so the form can't reveal who has an account. */
export async function requestPasswordReset(_prev: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get("email") ?? "").trim();
  if (validateSignIn({ email, password: "placeholder" }).email) return { error: "Enter a valid email address." };
  try {
    await publicApi("auth/password-reset", { method: "POST", json: { email } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 501) return { error: "Password reset isn't available on this server yet." };
    if (!(error instanceof ApiError && error.status < 500)) return { error: errorMessage(error) };
  }
  return { sent: true };
}

/** Sets the new password with the one-time session from the emailed link. */
export async function completePasswordReset(_prev: ResetState, form: FormData): Promise<ResetState> {
  const accessToken = String(form.get("accessToken") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!accessToken) return { error: "This reset link is incomplete. Request a new one." };
  const passwordError = validateSignIn({ email: "a@b.co", password }).password;
  if (passwordError) return { error: passwordError };
  if (password !== confirm) return { error: "The passwords don't match." };
  try {
    await publicApi("auth/password-reset/complete", { method: "POST", json: { accessToken, password } });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect("/sign-in?reset=1");
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
