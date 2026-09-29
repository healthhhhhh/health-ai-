"use client";

import { escalationMessage, triage } from "@healthmate/safety";
import type { ImagePurpose } from "@healthmate/shared-types";
import { Camera, CircleAlert, ImagePlus, Lightbulb, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StepProgress } from "@/components/ui/step-progress";
import { EscalationCard } from "@/features/chat/escalation-card";
import { cn } from "@/lib/cn";
import { CAPTURE_TIPS, GET_HELP_NOW, PHOTO_PURPOSES, photoPurpose } from "@/lib/photo-check";
import { byteSize } from "@/lib/reports";
import { cleanImage, uploadDocument } from "./upload-client";

const STEPS = ["What it shows", "Take the photo", "Check and send"];
const TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];
const MAX_BYTES = 20 * 1024 * 1024;

/** Photo check: say what the photo shows, take it with guidance, review it, then send. */
export function PhotoCheckFlow({ initialPurpose, retake = false }: { initialPurpose?: ImagePurpose; retake?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [purpose, setPurpose] = useState<ImagePurpose | null>(initialPurpose ?? null);
  const [step, setStep] = useState(initialPurpose ? 1 : 0);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const chosen = photoPurpose(purpose ?? undefined);
  // Safety first: an emergency or urgent note shows guidance immediately, before anything is sent.
  const escalation = useMemo(() => {
    const result = triage(note);
    return result.level === "emergency" || result.level === "urgent" ? escalationMessage(result) : null;
  }, [note]);

  const pick = (next: File | undefined) => {
    if (!next) return;
    if (!TYPES.includes(next.type.toLowerCase()) && !/\.(jpe?g|png|heic)$/i.test(next.name)) {
      setError("That isn't a photo we can check. Use a JPG, PNG or HEIC photo.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("That photo is larger than 20 MB. Try a smaller one.");
      return;
    }
    setError(null);
    setFile(next);
    setStep(2);
  };

  const send = () =>
    start(async () => {
      if (!file || !purpose) return;
      setError(null);
      if (!navigator.onLine) {
        setError("You're offline. Connect to the internet and try again — your photo is still here.");
        return;
      }
      try {
        const form = new FormData();
        form.set("file", await cleanImage(file));
        form.set("kind", "image");
        form.set("purpose", purpose);
        if (note.trim()) form.set("note", note.trim());
        router.push(`/reports/${await uploadDocument(form)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The upload didn't complete. Please try again.");
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <aside aria-label="When not to wait" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption text-text-primary">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
        {GET_HELP_NOW}
      </aside>
      <ol aria-label="Photo check steps" className="flex gap-2">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-pill", i <= step ? "bg-primary-fill" : "bg-card-muted ring-1 ring-separator")} />
            <span className={cn("truncate text-xs", i === step ? "font-semibold text-text-primary" : "text-text-secondary")}>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      {retake && step < 2 && (
        <p className="flex gap-2 rounded-md bg-primary-soft p-3 text-caption text-text-primary">
          <RotateCcw aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          The last photo wasn&apos;t clear enough to describe. The tips below help a retake work.
        </p>
      )}

      {step === 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-section-heading text-text-primary">What does the photo show?</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PHOTO_PURPOSES.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-lg bg-card p-4 ring-1 ring-separator has-[:checked]:ring-2 has-[:checked]:ring-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                )}
              >
                <input type="radio" name={`${ids}-purpose`} value={p.id} checked={purpose === p.id} onChange={() => setPurpose(p.id)} className="sr-only" />
                <span className="text-body font-semibold text-text-primary">{p.label}</span>
                <span className="text-caption text-text-secondary">{p.description}</span>
              </label>
            ))}
          </div>
          <div>
            <Button onClick={() => setStep(1)} disabled={!purpose}>
              Continue
            </Button>
          </div>
        </fieldset>
      )}

      {step === 1 && chosen && (
        <section aria-labelledby={`${ids}-take`} className="flex flex-col gap-4">
          <div>
            <h2 id={`${ids}-take`} className="text-section-heading text-text-primary">
              Take a clear photo
            </h2>
            <p className="text-caption text-text-secondary">
              {chosen.label} ·{" "}
              <button type="button" onClick={() => setStep(0)} className="font-semibold text-primary hover:underline">
                Change
              </button>
            </p>
          </div>
          <ul className="flex flex-col gap-2 rounded-lg bg-card-muted p-4">
            {[chosen.tip, ...CAPTURE_TIPS].map((tip) => (
              <li key={tip} className="flex gap-2 text-caption text-text-primary">
                <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {tip}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill bg-primary-fill px-5 text-body font-semibold text-on-primary shadow-raised focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 hover:bg-primary-pressed">
              <Camera aria-hidden className="size-4" /> Take a photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill bg-card px-5 text-body font-semibold text-primary ring-1 ring-separator focus-within:ring-2 focus-within:ring-primary hover:bg-primary-soft">
              <ImagePlus aria-hidden className="size-4" /> Choose a photo
              <input type="file" accept="image/jpeg,image/png,image/heic" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
          </div>
          <p className="text-caption text-text-secondary">Location and other details stored in the photo are removed before it&apos;s uploaded.</p>
        </section>
      )}

      {step === 2 && file && chosen && (
        <section aria-labelledby={`${ids}-review`} className="flex flex-col gap-4">
          <h2 id={`${ids}-review`} className="text-section-heading text-text-primary">
            Check your photo
          </h2>
          {escalation && <EscalationCard escalation={escalation} />}
          <div className="flex flex-col gap-3 sm:flex-row">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element -- a local, not-yet-uploaded photo
              <img src={preview} alt={`Your photo: ${chosen.label.toLowerCase()}`} className="max-h-72 rounded-lg bg-card-muted object-contain ring-1 ring-separator sm:w-72" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-caption text-text-secondary">
                {chosen.label} · {file.name} · {byteSize(file.size)}
              </p>
              <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-primary">
                Anything else to mention? (optional)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={pending}
                  placeholder="e.g. itchy for 3 days, getting bigger"
                  className="rounded-md bg-card p-3 font-normal ring-1 ring-separator"
                />
                <span className="self-end text-xs font-normal text-text-muted">{note.length}/500</span>
              </label>
            </div>
          </div>
          {pending ? (
            <StepProgress steps={[{ label: "Uploading securely" }, { label: "Looking at the photo" }, { label: "Writing what we can see" }]} current={0} label="Upload progress" />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={send}>{error ? "Try again" : "Check this photo"}</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setStep(1);
                }}
              >
                <RotateCcw aria-hidden /> Retake
              </Button>
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <p className="text-caption text-text-secondary">Photo checks describe what&apos;s visible and suggest next steps. They can&apos;t diagnose — a clinician needs to examine you for that.</p>
    </div>
  );
}
