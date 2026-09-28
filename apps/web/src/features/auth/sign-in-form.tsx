"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { authenticate, type AuthFormState } from "./actions";

/** Sign in or create an account. Credentials go to the Next.js server, which holds the session in httpOnly cookies. */
export function SignInForm({
  next,
  expired = false,
  passwordReset = false,
  initialMode = "sign-in",
}: {
  next?: string;
  expired?: boolean;
  passwordReset?: boolean;
  initialMode?: AuthFormState["mode"];
}) {
  const [mode, setMode] = useState<AuthFormState["mode"]>(initialMode);
  const [state, action, pending] = useActionState(authenticate, { mode: initialMode, errors: {} });
  // The browser's time zone, for greetings and reminders; read when the form is submitted.
  const submit = (form: FormData) => {
    form.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    return action(form);
  };
  const errors = state.mode === mode ? state.errors : {};
  const message = state.mode === mode ? state.message : undefined;
  // A notice (e.g. "confirm your email") switches the form to sign-in.
  const notice = state.notice && mode === "sign-in" ? state.notice : undefined;
  const [shownNotice, setShownNotice] = useState<string | undefined>();
  if (state.notice && state.notice !== shownNotice) {
    setShownNotice(state.notice);
    setMode("sign-in");
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Account" className="inline-flex gap-1 self-start rounded-pill bg-card-muted p-1 ring-1 ring-separator">
        {(["sign-in", "sign-up"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "h-9 rounded-pill px-4 text-caption font-semibold transition-colors",
              mode === value ? "bg-card text-primary shadow-card" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {value === "sign-in" ? "Sign in" : "New account"}
          </button>
        ))}
      </div>
      {(notice ?? (passwordReset ? "Your password was changed. Sign in with the new one." : undefined)) && !message && (
        <p role="status" className="rounded-md bg-primary-soft p-3 text-caption text-text-primary">
          {notice ?? "Your password was changed. Sign in with the new one."}
        </p>
      )}
      {expired && !message && !notice && (
        <p role="status" className="rounded-md bg-primary-soft p-3 text-caption text-text-primary">
          Your session ended. Please sign in again.
        </p>
      )}
      <form noValidate action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "sign-up" && (
          <Input label="First name" name="firstName" autoComplete="given-name" defaultValue={state.values?.firstName} error={errors.firstName} />
        )}
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={state.values?.email} error={errors.email} />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          error={errors.password}
          hint={mode === "sign-up" ? "At least 8 characters." : undefined}
        />
        {mode === "sign-in" && (
          <Link href="/forgot-password" className="-mt-2 self-end text-caption font-semibold text-primary hover:underline">
            Forgot password?
          </Link>
        )}
        {message && (
          <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {message}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth className="mt-2" disabled={pending}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign In" : "Create Account"}
        </Button>
      </form>
    </div>
  );
}
