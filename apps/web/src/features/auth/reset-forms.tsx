"use client";

import { AlertCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset, requestPasswordReset, type ResetState } from "./actions";

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(requestPasswordReset, {});
  if (state.sent) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className="flex gap-2 rounded-md bg-primary-soft p-3 text-body text-text-primary">
          <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          If an account uses that email, we&apos;ve sent a link to reset the password. It expires in an hour.
        </p>
        <Link href="/sign-in" className="text-caption font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form noValidate action={action} className="flex flex-col gap-4">
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" />
      <ErrorNote message={state.error} />
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Please wait…" : "Send Reset Link"}
      </Button>
      <Link href="/sign-in" className="self-center text-caption font-semibold text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

/**
 * The emailed link lands here with a one-time session in the URL fragment
 * (never sent to any server by the browser). We read it, remove it from the
 * address bar and history, and send it only with the new password.
 */
export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(completePasswordReset, {});
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    // Reading the fragment is only possible after mount (it never reaches the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(accessToken && params.get("type") === "recovery" ? accessToken : null);
    setChecked(true);
  }, []);

  if (checked && !token) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNote message="This reset link is invalid or has expired." />
        <Link href="/forgot-password" className="text-caption font-semibold text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }
  return (
    <form noValidate action={action} className="flex flex-col gap-4">
      <input type="hidden" name="accessToken" value={token ?? ""} />
      <Input label="New password" name="password" type="password" autoComplete="new-password" hint="At least 8 characters." />
      <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
      <ErrorNote message={state.error} />
      <Button type="submit" size="lg" fullWidth disabled={pending || !token}>
        {pending ? "Please wait…" : "Set New Password"}
      </Button>
    </form>
  );
}
