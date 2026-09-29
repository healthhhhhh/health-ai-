"use client";

import { AlertCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { resendVerification } from "./actions";

const COOLDOWN_SECONDS = 30;

/** "Check your inbox" after sign-up: resend (with a cooldown), change the email, or open the Preview inbox. */
export function VerifyEmailPanel({ email, preview }: { email: string; preview: boolean }) {
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = () =>
    start(async () => {
      setError(null);
      const result = await resendVerification(email);
      if (result.ok) {
        setSent(true);
        setCooldown(COOLDOWN_SECONDS);
      } else setError(result.error ?? "We couldn't send the email. Please try again.");
    });

  return (
    <div className="flex flex-col gap-5">
      <p className="flex gap-3 rounded-md bg-primary-soft p-4 text-body text-text-primary">
        <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>
          We sent a confirmation link to <strong className="font-semibold break-all">{email || "your email"}</strong>. Open it on this device to finish creating your
          account.
        </span>
      </p>
      {preview && (
        <ButtonLink href={`/preview/inbox?email=${encodeURIComponent(email)}`} size="lg" fullWidth>
          Open Preview inbox
        </ButtonLink>
      )}
      <div aria-live="polite" className="min-h-5 text-caption">
        {sent && !error && <span className="text-success">Sent. It can take a minute to arrive — check your spam folder too.</span>}
        {error && (
          <span role="alert" className="flex gap-2 font-medium text-error">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </span>
        )}
      </div>
      <Button variant="secondary" fullWidth disabled={!email || pending || cooldown > 0} onClick={resend}>
        {pending ? "Sending…" : cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend email"}
      </Button>
      <div className="flex justify-between text-caption font-semibold">
        <Link href="/sign-in?mode=sign-up" className="text-primary hover:underline">
          Use a different email
        </Link>
        <Link href="/sign-in" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
