"use client";

import { FlaskConical, Inbox, LogIn, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { parseControls, PREVIEW_CONTROLS_COOKIE, PREVIEW_STATE_LABELS, PREVIEW_STATES, type PreviewState } from "@/lib/preview/controls";
import { previewQuickSignIn, previewReset } from "./actions";

function readState(): PreviewState {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${PREVIEW_CONTROLS_COOKIE}=`));
  return parseControls(raw?.slice(PREVIEW_CONTROLS_COOKIE.length + 1)).state;
}

function writeState(next: PreviewState) {
  document.cookie = `${PREVIEW_CONTROLS_COOKIE}=${encodeURIComponent(JSON.stringify({ state: next }))}; path=/; max-age=31536000; samesite=lax`;
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Preview-mode developer panel: force screens into loading, empty, error,
 * offline or permission states, reset the sample account, open the inbox.
 * Only rendered in Preview mode.
 */
export function PreviewPanel({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>("normal");
  const [pending, startTransition] = useTransition();
  const titleId = useId();

  useEffect(() => {
    // The cookie is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readState());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = (next: PreviewState) => {
    setState(next);
    writeState(next);
    startTransition(() => router.refresh());
  };

  return (
    <div className="fixed bottom-24 left-4 z-40 md:bottom-4">
      {open && (
        <section
          role="dialog"
          aria-labelledby={titleId}
          className="mb-3 w-[min(20rem,calc(100vw-2rem))] rounded-xl bg-card p-4 shadow-raised ring-1 ring-separator"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-card-title text-text-primary">
                Preview mode
              </h2>
              <p className="mt-0.5 text-caption text-text-secondary">Sample account and sample AI responses. Nothing leaves this device.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close preview panel" className="rounded-full p-1 text-text-secondary hover:bg-card-muted">
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <fieldset className="mt-4">
            <legend className="text-caption font-semibold text-text-primary">Show screens as</legend>
            <div className="mt-2 flex flex-col gap-1">
              {PREVIEW_STATES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors",
                    state === value ? "bg-primary-soft" : "hover:bg-card-muted",
                  )}
                >
                  <input type="radio" name="preview-state" value={value} checked={state === value} onChange={() => choose(value)} className="mt-1 accent-[var(--color-primary)]" />
                  <span>
                    <span className="block text-body font-medium text-text-primary">{PREVIEW_STATE_LABELS[value].label}</span>
                    <span className="block text-caption text-text-secondary">{PREVIEW_STATE_LABELS[value].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-col gap-2 border-t border-separator pt-3">
            <Link href="/preview/inbox" className="flex items-center gap-2 text-caption font-semibold text-primary hover:underline">
              <Inbox aria-hidden className="size-4" /> Preview inbox (emails HealthMate sent)
            </Link>
            {signedIn ? (
              <button type="button" disabled={pending} onClick={() => startTransition(() => previewReset(timeZone()))} className="flex items-center gap-2 text-left text-caption font-semibold text-primary hover:underline">
                <RotateCcw aria-hidden className="size-4" /> Reset sample account
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => startTransition(() => previewQuickSignIn(timeZone()))} className="flex items-center gap-2 text-left text-caption font-semibold text-primary hover:underline">
                <LogIn aria-hidden className="size-4" /> Skip sign-in (sample account)
              </button>
            )}
            <p className="text-caption text-text-muted">Tip: the password “wrong-password” shows the sign-in error.</p>
          </div>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-pill bg-warning-soft px-3.5 py-2 text-caption font-semibold text-warning shadow-card ring-1 ring-warning/20 transition-transform hover:scale-[1.02]",
          state !== "normal" && "ring-2 ring-warning",
        )}
      >
        <FlaskConical aria-hidden className="size-4" />
        Preview{state !== "normal" ? ` · ${PREVIEW_STATE_LABELS[state].label}` : ""}
      </button>
    </div>
  );
}
