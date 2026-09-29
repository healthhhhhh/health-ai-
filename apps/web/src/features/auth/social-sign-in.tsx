"use client";

import { AlertCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { continueWithProvider } from "./actions";

function AppleMark() {
  return (
    <svg aria-hidden viewBox="0 0 17 20" className="size-[18px] fill-current">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2.1-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-[18px]">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/**
 * Continue with Apple / Google. Phase 1: signs in to the Preview sample
 * account (no real OAuth yet); new accounts continue to onboarding.
 */
export function SocialSignIn() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (provider: "apple" | "google") =>
    start(async () => {
      setError(null);
      const result = await continueWithProvider(provider, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      if (result?.error) setError(result.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => go("apple")}
        className="flex h-12 items-center justify-center gap-2.5 rounded-pill bg-text-primary text-body font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <AppleMark /> Continue with Apple
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => go("google")}
        className="flex h-12 items-center justify-center gap-2.5 rounded-pill bg-card text-body font-semibold text-text-primary ring-1 ring-separator transition-colors hover:bg-card-muted disabled:opacity-50"
      >
        <GoogleMark /> Continue with Google
      </button>
      {error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-caption text-text-muted" aria-hidden>
        <span className="h-px flex-1 bg-separator" /> or use email <span className="h-px flex-1 bg-separator" />
      </div>
    </div>
  );
}
