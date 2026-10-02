"use client";

import type { ConsentKind } from "@healthmate/shared-types";
import { AlertCircle, ArrowLeft, Check, FileText, HeartPulse, MessageCircle, ShieldCheck, Smartphone, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { PermissionPrimer } from "@/components/ui/permission-primer";
import { Switch } from "@/components/ui/switch";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { DeleteAccountForm } from "@/features/settings/delete-account-form";
import { completeOnboarding, confirmAge, type OnboardingInput } from "./actions";

const STEPS = [
  { id: "welcome", title: "Welcome to HealthMate" },
  { id: "about", title: "About you" },
  { id: "privacy", title: "Your privacy choices" },
  { id: "sync", title: "Apple Health" },
  { id: "done", title: "You're all set" },
] as const;

const SEX_OPTIONS = [
  { value: "", label: "Choose (optional)" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const CONSENT_COPY: { kind: ConsentKind; title: string; description: string }[] = [
  { kind: "ai_processing", title: "AI Health Assistant", description: "Lets the assistant use what you share in chat to answer. Needed for AI chat." },
  { kind: "document_processing", title: "Report and photo analysis", description: "Lets HealthMate read reports and photos you upload to explain them in plain language." },
  { kind: "health_data_sync", title: "Health data sync", description: "Lets HealthMate store readings from Apple Health (set up in the iPhone app)." },
  { kind: "voice", title: "Voice input", description: "Lets you speak to the assistant. Audio is transcribed and not kept." },
];

const WELCOME_POINTS = [
  { icon: <MessageCircle aria-hidden className="size-5" />, text: "Ask health questions and get plain-language answers" },
  { icon: <FileText aria-hidden className="size-5" />, text: "Understand medical reports and letters" },
  { icon: <TrendingUp aria-hidden className="size-5" />, text: "See how your readings change over time" },
];

export interface OnboardingDefaults {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  goals: string[];
  consents: Record<ConsentKind, boolean>;
}

type Step = (typeof STEPS)[number]["id"];
/** The server restricted this account, or (`device`) recently restricted one in this browser. */
type Restriction = "age_review" | "age_not_eligible" | "device";

/**
 * First-run setup: welcome, name and date of birth (checked by the server before
 * anything else is saved), privacy choices, Apple Health (connected from the
 * iPhone app) and a summary. Also shown to accounts whose age the server hasn't
 * confirmed or can't serve.
 */
export function OnboardingWizard({
  defaults,
  preview,
  restricted: initialRestriction = null,
  deletionScheduled = false,
  hasPassword = true,
}: {
  defaults: OnboardingDefaults;
  preview: boolean;
  restricted?: Restriction | null;
  deletionScheduled?: boolean;
  /** False for accounts that sign in with Google / Apple only (deletion is confirmed by typing DELETE). */
  hasPassword?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const current = STEPS[index] ?? STEPS[0];
  const step: Step = current.id;
  const [data, setData] = useState<OnboardingInput>({
    firstName: defaults.firstName,
    lastName: defaults.lastName,
    dateOfBirth: defaults.dateOfBirth,
    sex: defaults.sex,
    goals: defaults.goals,
    consents: defaults.consents,
  });
  const [restriction, setRestriction] = useState<Restriction | null>(initialRestriction);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; dateOfBirth?: string }>({});
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    // Move focus to the new step's heading so screen readers announce it (not on first load).
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [index, restriction]);

  if (restriction) {
    return <RestrictedPanel reason={restriction} deletionScheduled={deletionScheduled || restriction === "age_not_eligible"} hasPassword={hasPassword} headingRef={heading} />;
  }

  const update = (patch: Partial<OnboardingInput>) => setData((d) => ({ ...d, ...patch }));
  const goNext = () => {
    setError(null);
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const next = () => {
    if (step !== "about") return goNext();
    const errors = {
      firstName: data.firstName.trim() ? undefined : "Enter your first name.",
      dateOfBirth: data.dateOfBirth ? undefined : "Enter your date of birth.",
    };
    setFieldErrors(errors);
    if (errors.firstName || errors.dateOfBirth) return;
    // The server decides who can use HealthMate; nothing else is saved before it has.
    start(async () => {
      setError(null);
      const result = await confirmAge(data.dateOfBirth);
      if ("error" in result) return setError(result.error);
      if ("deviceBlocked" in result) return setRestriction("device");
      if (result.eligibility === "eligible") return goNext();
      if (result.eligibility === "age_review" || result.eligibility === "age_not_eligible") return setRestriction(result.eligibility);
      setError("We couldn't confirm your date of birth. Please try again.");
    });
  };
  const back = () => {
    setError(null);
    setIndex((i) => Math.max(i - 1, 0));
  };
  const finish = () =>
    start(async () => {
      setError(null);
      const result = await completeOnboarding(data);
      if (result?.error) setError(result.error);
    });

  // The welcome screen isn't counted as a step.
  const total = STEPS.length - 2;
  const optional = step === "sync";

  return (
    <div className="rounded-xl bg-card p-6 shadow-card sm:p-8">
      {step !== "done" && step !== "welcome" && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-caption text-text-secondary">
            <span>
              Step {index} of {total}
            </span>
            {optional && <span className="font-semibold">Optional</span>}
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} className="h-1.5 overflow-hidden rounded-pill bg-card-muted">
            <div className="h-full rounded-pill bg-primary-fill transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(index / total) * 100}%` }} />
          </div>
        </div>
      )}

      <h1 ref={heading} tabIndex={-1} className="text-page-heading text-text-primary focus:outline-none">
        {step === "done" ? `You're all set${data.firstName.trim() ? `, ${data.firstName.trim()}` : ""}` : current.title}
      </h1>

      <div className="mt-2">
        {step === "welcome" && (
          <div className="flex flex-col gap-5">
            <p className="text-body text-text-secondary">Your AI health companion. Setup takes about a minute.</p>
            <ul className="flex flex-col gap-3">
              {WELCOME_POINTS.map((point) => (
                <li key={point.text} className="flex items-center gap-3 rounded-md bg-card-muted p-3 text-body text-text-primary">
                  <span className="text-primary">{point.icon}</span>
                  {point.text}
                </li>
              ))}
            </ul>
            <p className="text-caption text-text-secondary">HealthMate gives general information, not medical advice. In an emergency, call 911.</p>
          </div>
        )}

        {step === "about" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">We need your name and date of birth. Everything else is optional.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="First name" value={data.firstName} onChange={(e) => update({ firstName: e.target.value })} autoComplete="given-name" error={fieldErrors.firstName} maxLength={80} />
              <Input label="Last name (optional)" value={data.lastName} onChange={(e) => update({ lastName: e.target.value })} autoComplete="family-name" maxLength={80} />
            </div>
            <Input
              label="Date of birth"
              type="date"
              value={data.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => update({ dateOfBirth: e.target.value })}
              autoComplete="bday"
              error={fieldErrors.dateOfBirth}
              hint="Used to confirm you can use HealthMate and to give age-appropriate information. It's never sent to the AI."
            />
            <Select label="Sex (optional)" value={data.sex} onChange={(e) => update({ sex: e.target.value })} options={SEX_OPTIONS} hint="Used only to give context to readings and reports." />
          </div>
        )}

        {step === "privacy" && (
          <div className="flex flex-col gap-2">
            <p className="text-body text-text-secondary">Each is off until you turn it on, and you can change them any time in Settings › Privacy.</p>
            <div className="divide-y divide-separator">
              {CONSENT_COPY.map((c) => (
                <Switch
                  key={c.kind}
                  label={c.title}
                  description={c.description}
                  checked={data.consents[c.kind]}
                  onChange={(granted) => update({ consents: { ...data.consents, [c.kind]: granted } })}
                />
              ))}
            </div>
            <p className="flex items-start gap-2 rounded-md bg-card-muted p-3 text-caption text-text-secondary">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              Your health information is never sold or used for advertising. You can download or delete it at any time.
            </p>
          </div>
        )}

        {step === "sync" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">Apple Health connects from the HealthMate app on your iPhone — it can&apos;t be connected from a web browser.</p>
            <PermissionPrimer
              icon={<HeartPulse />}
              tone="red"
              title="Bring in readings from Apple Health"
              description="On your iPhone, HealthMate can read the measurements you choose — you decide which ones."
              benefits={["Steps, sleep, heart rate and more, in one place", "Compared with your own usual range over time", "Read-only: HealthMate never writes to Apple Health"]}
              privacyNote="Readings are only imported after you allow them on your iPhone. You can turn off any measurement, or disconnect, in the Health app."
              status="unavailable"
            />
            <p className="flex items-center gap-2 text-caption text-text-secondary">
              <Smartphone aria-hidden className="size-4 text-primary" /> Later, open HealthMate on your iPhone and choose Health › Connect Apple Health.
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-5">
            <p className="text-body text-text-secondary">Here&apos;s what you set up. You can change any of it later in Profile and Settings.</p>
            <ul className="flex flex-col gap-2.5">
              <SummaryRow label="Name" value={[data.firstName.trim(), data.lastName.trim()].filter(Boolean).join(" ")} />
              <SummaryRow label="Date of birth" value="Confirmed" />
              <SummaryRow label="Privacy" value={`${CONSENT_COPY.filter((c) => data.consents[c.kind]).length} of ${CONSENT_COPY.length} turned on`} />
              <SummaryRow label="Apple Health" value="Not connected — connect it in the iPhone app" done={false} />
            </ul>
            {preview && <p className="rounded-md bg-card-muted p-3 text-caption text-text-secondary">Preview mode: your Home screen will show a sample account so you can explore every feature.</p>}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-5 flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        {index > 0 ? (
          <Button variant="ghost" onClick={back} disabled={pending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {step === "done" ? (
            <Button size="lg" onClick={finish} disabled={pending}>
              {pending ? "Saving…" : "Go to Home"}
            </Button>
          ) : (
            <Button size="lg" onClick={next} disabled={pending}>
              {pending ? "Checking…" : step === "welcome" ? "Get started" : "Continue"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** What a person sees when the server can't let them use HealthMate (yet). No health data is collected here. */
function RestrictedPanel({
  reason,
  deletionScheduled,
  hasPassword,
  headingRef,
}: {
  reason: Restriction;
  deletionScheduled: boolean;
  hasPassword: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const heading =
    reason === "age_not_eligible" ? "HealthMate isn't available for you" : reason === "age_review" ? "We need to check your age" : "We can't set up HealthMate here right now";
  return (
    <div className="rounded-xl bg-card p-6 shadow-card sm:p-8">
      <h1 ref={headingRef} tabIndex={-1} className="text-page-heading text-text-primary focus:outline-none">
        {heading}
      </h1>
      <div className="mt-3 flex flex-col gap-3 text-body text-text-secondary">
        {reason === "age_not_eligible" && (
          <>
            <p>HealthMate is for people 13 and older, so we can&apos;t set up this account.</p>
            {deletionScheduled && <p>Nothing you add is used, and this account will be deleted soon.</p>}
          </>
        )}
        {reason === "age_review" && <p>The date of birth you entered doesn&apos;t match what we have on record, so someone needs to check it before you can continue.</p>}
        {reason === "device" && <p>An age check in this browser recently didn&apos;t allow setup, so we can&apos;t take another date of birth here for now.</p>}
        <p>
          If a date was entered by mistake, see{" "}
          <Link href="/help" className="font-semibold text-primary underline-offset-2 hover:underline">
            Help
          </Link>{" "}
          to contact us.
        </p>
        <p className="text-caption">If you&apos;re in danger or thinking about hurting yourself, call or text 988, or call 911.</p>
      </div>
      <div className="mt-6">
        <SignOutButton />
      </div>
      <details className="mt-6 rounded-md bg-card-muted p-4">
        <summary className="cursor-pointer text-body font-semibold text-text-primary">Delete my account now</summary>
        <div className="mt-3">
          <DeleteAccountForm hasPassword={hasPassword} />
        </div>
      </details>
    </div>
  );
}

function SummaryRow({ label, value, done = true }: { label: string; value: string; done?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-md bg-card-muted p-3">
      {done ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />}
      <span>
        <span className="block text-caption font-semibold text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{value}</span>
      </span>
    </li>
  );
}
