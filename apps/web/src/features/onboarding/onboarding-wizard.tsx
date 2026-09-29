"use client";

import type { ConsentKind } from "@healthmate/shared-types";
import { AlertCircle, ArrowLeft, Bell, Check, HeartPulse, Plus, ShieldCheck, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { PermissionPrimer, type PermissionStatus } from "@/components/ui/permission-primer";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { HEALTH_GOALS } from "@/lib/onboarding";
import { completeOnboarding, type OnboardingInput } from "./actions";

const STEPS = [
  { id: "about", title: "About you" },
  { id: "goals", title: "What would help most?" },
  { id: "health", title: "Your health details" },
  { id: "privacy", title: "Your privacy choices" },
  { id: "reminders", title: "Reminders" },
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
  { kind: "health_data_sync", title: "Health data sync", description: "Lets HealthMate store readings from Apple Health or that you add yourself." },
  { kind: "voice", title: "Voice input", description: "Lets you speak to the assistant. Audio is transcribed and not kept." },
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

/**
 * First-run setup after creating an account. Everything except a first name
 * is optional and can be changed later in Profile and Settings; nothing is
 * saved until the last step.
 */
export function OnboardingWizard({ defaults, preview }: { defaults: OnboardingDefaults; preview: boolean }) {
  const [index, setIndex] = useState(0);
  const current = STEPS[index] ?? STEPS[0];
  const step: Step = current.id;
  const [data, setData] = useState<OnboardingInput>({
    firstName: defaults.firstName,
    lastName: defaults.lastName,
    dateOfBirth: defaults.dateOfBirth,
    sex: defaults.sex,
    goals: defaults.goals,
    conditions: [],
    allergies: [],
    medications: [],
    consents: defaults.consents,
    reminders: { medication: true, task: true, appointment: true, showDetails: false },
  });
  const [error, setError] = useState<string | null>(null);
  const [firstNameError, setFirstNameError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    // Move focus to the new step's heading so screen readers announce it (not on first load).
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [index]);

  const update = (patch: Partial<OnboardingInput>) => setData((d) => ({ ...d, ...patch }));
  const next = () => {
    if (step === "about" && !data.firstName.trim()) {
      setFirstNameError("Enter your first name.");
      return;
    }
    setFirstNameError(undefined);
    setError(null);
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
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

  const total = STEPS.length - 1;
  const optional = step === "health" || step === "sync";

  return (
    <div className="rounded-xl bg-card p-6 shadow-card sm:p-8">
      {step !== "done" && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-caption text-text-secondary">
            <span>
              Step {index + 1} of {total}
            </span>
            {optional && <span className="font-semibold">Optional</span>}
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1} className="h-1.5 overflow-hidden rounded-pill bg-card-muted">
            <div className="h-full rounded-pill bg-primary-fill transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
      )}

      <h1 ref={heading} tabIndex={-1} className="text-page-heading text-text-primary focus:outline-none">
        {step === "done" ? `You're all set${data.firstName.trim() ? `, ${data.firstName.trim()}` : ""}` : current.title}
      </h1>

      <div className="mt-2">
        {step === "about" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">This helps the assistant speak to you personally. Only your first name is needed.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="First name" value={data.firstName} onChange={(e) => update({ firstName: e.target.value })} autoComplete="given-name" error={firstNameError} maxLength={80} />
              <Input label="Last name (optional)" value={data.lastName} onChange={(e) => update({ lastName: e.target.value })} autoComplete="family-name" maxLength={80} />
            </div>
            <Input
              label="Date of birth (optional)"
              type="date"
              value={data.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => update({ dateOfBirth: e.target.value })}
              autoComplete="bday"
              hint="Some health measures depend on age."
            />
            <Select label="Sex (optional)" value={data.sex} onChange={(e) => update({ sex: e.target.value })} options={SEX_OPTIONS} hint="Used only to give context to readings and reports." />
          </div>
        )}

        {step === "goals" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">Choose any that apply. We&apos;ll shape your Home screen and suggestions around them.</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {HEALTH_GOALS.map((goal) => {
                const selected = data.goals.includes(goal.id);
                return (
                  <li key={goal.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => update({ goals: selected ? data.goals.filter((g) => g !== goal.id) : [...data.goals, goal.id] })}
                      className={cn(
                        "flex h-full w-full items-start gap-3 rounded-lg p-4 text-left ring-1 transition-colors",
                        selected ? "bg-primary-soft ring-2 ring-primary" : "bg-card ring-separator hover:bg-card-muted",
                      )}
                    >
                      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", selected ? "bg-primary-fill text-on-primary" : "ring-1 ring-separator")}>
                        {selected && <Check aria-hidden className="size-3.5" />}
                      </span>
                      <span>
                        <span className="block text-body font-semibold text-text-primary">{goal.label}</span>
                        <span className="block text-caption text-text-secondary">{goal.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === "health" && <HealthDetailsStep data={data} update={update} />}

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
              Your health information is never sold or used for advertising. You can export or delete it at any time.
            </p>
          </div>
        )}

        {step === "reminders" && <RemindersStep data={data} update={update} />}

        {step === "sync" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">Apple Health connects from the HealthMate app on your iPhone. You can do this later from Health › Connect.</p>
            <PermissionPrimer
              icon={<HeartPulse />}
              tone="red"
              title="Bring in readings from Apple Health"
              description="With your permission, HealthMate reads the measurements you choose — you decide which ones."
              benefits={["Steps, sleep, heart rate and more, in one place", "Compared with your own usual range over time", "Read-only: HealthMate never writes to Apple Health"]}
              privacyNote="You can turn off any measurement, or disconnect completely, in the Health app on your iPhone."
            />
            <p className="flex items-center gap-2 text-caption text-text-secondary">
              <Smartphone aria-hidden className="size-4 text-primary" /> Open HealthMate on your iPhone and choose Health › Connect Apple Health.
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-5">
            <p className="text-body text-text-secondary">Here&apos;s what you chose. You can change any of it later in Profile and Settings.</p>
            <ul className="flex flex-col gap-2.5">
              <SummaryRow label="Goals" value={data.goals.length ? HEALTH_GOALS.filter((g) => data.goals.includes(g.id)).map((g) => g.label).join(", ") : "None chosen"} />
              <SummaryRow
                label="Health details you added"
                value={
                  data.conditions.length + data.allergies.length + data.medications.length
                    ? [plural(data.conditions.length, "condition"), plural(data.allergies.length, "allergy", "allergies"), plural(data.medications.length, "medication")].filter(Boolean).join(", ")
                    : "None yet"
                }
              />
              <SummaryRow label="Privacy" value={`${CONSENT_COPY.filter((c) => data.consents[c.kind]).length} of ${CONSENT_COPY.length} turned on`} />
              <SummaryRow
                label="Reminders"
                value={[data.reminders.medication && "medications", data.reminders.task && "tasks", data.reminders.appointment && "appointments"].filter(Boolean).join(", ") || "Off"}
              />
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
          {optional && (
            <Button variant="ghost" onClick={next}>
              Skip
            </Button>
          )}
          {step === "done" ? (
            <Button size="lg" onClick={finish} disabled={pending}>
              {pending ? "Saving…" : "Go to Home"}
            </Button>
          ) : (
            <Button size="lg" onClick={next}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return n ? `${n} ${n === 1 ? one : many}` : "";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md bg-card-muted p-3">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      <span>
        <span className="block text-caption font-semibold text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{value}</span>
      </span>
    </li>
  );
}

function HealthDetailsStep({ data, update }: { data: OnboardingInput; update: (patch: Partial<OnboardingInput>) => void }) {
  const [condition, setCondition] = useState("");
  const [allergy, setAllergy] = useState("");
  const [medName, setMedName] = useState("");
  const [medInstruction, setMedInstruction] = useState("");
  const [medError, setMedError] = useState<string | undefined>();

  const addMedication = () => {
    if (!medName.trim()) return setMedError("Enter the medication name.");
    if (!medInstruction.trim()) return setMedError("Copy the instructions exactly as written on your prescription or label.");
    setMedError(undefined);
    update({ medications: [...data.medications, { name: medName, instruction: medInstruction }] });
    setMedName("");
    setMedInstruction("");
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-text-secondary">
        Add anything you&apos;d like the assistant to keep in mind. It&apos;s saved as something <strong className="font-semibold">you added</strong> — you can edit or remove it later in Profile.
      </p>
      <ChipList
        label="Conditions"
        placeholder="e.g. a condition you've been diagnosed with"
        items={data.conditions}
        value={condition}
        onValue={setCondition}
        onAdd={() => {
          if (condition.trim()) update({ conditions: [...data.conditions, condition.trim()] });
          setCondition("");
        }}
        onRemove={(i) => update({ conditions: data.conditions.filter((_, j) => j !== i) })}
      />
      <ChipList
        label="Allergies"
        placeholder="e.g. something you're allergic to"
        items={data.allergies}
        value={allergy}
        onValue={setAllergy}
        onAdd={() => {
          if (allergy.trim()) update({ allergies: [...data.allergies, allergy.trim()] });
          setAllergy("");
        }}
        onRemove={(i) => update({ allergies: data.allergies.filter((_, j) => j !== i) })}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-card-title text-text-primary">Medications</legend>
        {data.medications.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.medications.map((m, i) => (
              <li key={`${m.name}-${i}`} className="flex items-start gap-3 rounded-md bg-card-muted p-3">
                <span className="flex-1">
                  <span className="block text-body font-semibold text-text-primary">{m.name}</span>
                  <span className="block text-caption text-text-secondary">{m.instruction}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => update({ medications: data.medications.filter((_, j) => j !== i) })}
                  className="rounded-full p-1 text-text-secondary hover:bg-card hover:text-text-primary"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <Input label="Medication name" value={medName} onChange={(e) => setMedName(e.target.value)} maxLength={120} />
          <Input
            label="Instructions exactly as written"
            value={medInstruction}
            onChange={(e) => setMedInstruction(e.target.value)}
            maxLength={500}
            hint="Copy them word for word from your prescription or label."
          />
        </div>
        {medError && (
          <p role="alert" className="text-caption font-medium text-error">
            {medError}
          </p>
        )}
        <Button variant="soft" size="sm" className="self-start" onClick={addMedication}>
          <Plus aria-hidden /> Add medication
        </Button>
      </fieldset>
    </div>
  );
}

function ChipList({
  label,
  placeholder,
  items,
  value,
  onValue,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  items: string[];
  value: string;
  onValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-card-title text-text-primary">{label}</legend>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <li key={`${item}-${i}`} className="inline-flex items-center gap-1 rounded-pill bg-primary-soft py-1 pr-1 pl-3 text-caption font-semibold text-primary">
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemove(i)} className="rounded-full p-1 hover:bg-primary-tint">
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
      >
        <div className="flex-1">
          <Input label={`Add to ${label.toLowerCase()}`} hideLabel placeholder={placeholder} value={value} onChange={(e) => onValue(e.target.value)} maxLength={120} />
        </div>
        <Button type="submit" variant="soft" aria-label={`Add to ${label.toLowerCase()}`}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
    </fieldset>
  );
}

function RemindersStep({ data, update }: { data: OnboardingInput; update: (patch: Partial<OnboardingInput>) => void }) {
  const [permission, setPermission] = useState<PermissionStatus>("prompt");
  useEffect(() => {
    // Read the browser's current notification permission once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!("Notification" in window)) setPermission("unavailable");
    else if (Notification.permission === "granted") setPermission("granted");
    else if (Notification.permission === "denied") setPermission("denied");
  }, []);
  const set = (patch: Partial<OnboardingInput["reminders"]>) => update({ reminders: { ...data.reminders, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-text-secondary">Choose what HealthMate can remind you about. You can fine-tune times and quiet hours in Settings.</p>
      <div className="divide-y divide-separator">
        <Switch label="Medication reminders" description="At the times in your plan, with the instructions you entered." checked={data.reminders.medication} onChange={(v) => set({ medication: v })} />
        <Switch label="Tasks and habits" description="Things you've added to My Plan." checked={data.reminders.task} onChange={(v) => set({ task: v })} />
        <Switch label="Appointments" description="The day before and on the day." checked={data.reminders.appointment} onChange={(v) => set({ appointment: v })} />
        <Switch
          label="Show health details in notifications"
          description="Off keeps notifications generic (e.g. “You have a reminder”) on shared screens."
          checked={data.reminders.showDetails}
          onChange={(v) => set({ showDetails: v })}
        />
      </div>
      <PermissionPrimer
        icon={<Bell />}
        title="Browser notifications"
        description="Allow notifications so reminders can reach you while HealthMate is open in another tab."
        status={permission}
        deniedHelp="Notifications are blocked for this site. You can allow them in your browser's site settings."
        actions={
          permission === "prompt" ? (
            <Button
              variant="secondary"
              onClick={async () => {
                const result = await Notification.requestPermission();
                setPermission(result === "granted" ? "granted" : result === "denied" ? "denied" : "prompt");
              }}
            >
              Allow notifications
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
