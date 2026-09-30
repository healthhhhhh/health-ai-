"use client";

import type { MemoryRecord } from "@healthmate/shared-types";
import { Check, Trash2 } from "lucide-react";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { addAllergy, addCondition, addMedication, addMemory, confirmMemory, deleteMemory, removeProfileItem, setMemoryAiExcluded, updateDetails, type FormState } from "./actions";

function Feedback({ state, success }: { state: FormState; success?: string }) {
  if (state.error)
    return (
      <p role="alert" className="text-caption font-medium text-error">
        {state.error}
      </p>
    );
  if (state.ok && success)
    return (
      <p role="status" className="text-caption font-medium text-success">
        {success}
      </p>
    );
  return null;
}

export function DetailsForm({ firstName, lastName, dateOfBirth }: { firstName: string; lastName: string; dateOfBirth: string | null }) {
  const [state, action, pending] = useActionState(updateDetails, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Input label="First name" name="firstName" defaultValue={firstName} autoComplete="given-name" required />
      <Input label="Last name" name="lastName" defaultValue={lastName} autoComplete="family-name" />
      <Input label="Date of birth" name="dateOfBirth" type="date" defaultValue={dateOfBirth ?? ""} autoComplete="bday" />
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} success="Saved." />
      </div>
    </form>
  );
}

export function AddConditionForm() {
  const [state, action, pending] = useActionState(addCondition, {});
  return (
    <form action={action} key={state.ok} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Input label="Add a condition you've been diagnosed with" name="name" placeholder="e.g. Asthma" />
        <Button type="submit" variant="soft" disabled={pending}>
          Add
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AddAllergyForm() {
  const [state, action, pending] = useActionState(addAllergy, {});
  return (
    <form action={action} key={state.ok} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Input label="Allergy" name="substance" placeholder="e.g. Penicillin" />
      <Input label="Reaction (optional)" name="reaction" placeholder="e.g. Rash" />
      <Button type="submit" variant="soft" disabled={pending}>
        Add
      </Button>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AddMedicationForm() {
  const [state, action, pending] = useActionState(addMedication, {});
  return (
    <form action={action} key={state.ok} className="flex flex-col gap-3">
      <Input label="Medication name" name="name" placeholder="e.g. Metformin" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="instruction" className="text-caption font-semibold text-text-primary">
          Instructions, exactly as written
        </label>
        <textarea
          id="instruction"
          name="instruction"
          rows={2}
          maxLength={500}
          aria-describedby="instruction-hint"
          className="rounded-md bg-card px-3.5 py-2.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary"
        />
        <p id="instruction-hint" className="text-caption text-text-secondary">
          Copy them from your prescription or pharmacy label. HealthMate stores them word for word and never suggests changing a medication or dose.
        </p>
      </div>
      <label className="flex items-center gap-2 text-caption text-text-primary">
        <input type="checkbox" name="fromClinician" defaultChecked className="size-4" /> These are my clinician&apos;s instructions
      </label>
      <Feedback state={state} />
      <Button type="submit" variant="soft" disabled={pending} className="self-start">
        Add medication
      </Button>
    </form>
  );
}

export function RemoveButton({ collection, id, label }: { collection: "conditions" | "allergies" | "medications"; id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${label}`}
      onClick={() => start(async () => void (await removeProfileItem(collection, id)))}
      className="rounded-md p-2 text-text-muted hover:bg-error-soft hover:text-error disabled:opacity-50"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  );
}

const MEMORY_LABEL: Record<MemoryRecord["status"], string> = {
  user_reported: "You told HealthMate",
  user_confirmed: "Confirmed by you",
  document_extracted: "From a report",
  healthkit: "From Apple Health",
  clinician_provided: "From your clinician",
  ai_inferred: "Unconfirmed suggestion",
  superseded: "Replaced",
};

/** AI-inferred facts are labelled unconfirmed until the person confirms them. */
export function MemoryRow({ memory }: { memory: MemoryRecord }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body text-text-primary">{memory.fact}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={memory.status === "ai_inferred" ? "warning" : "neutral"} showIcon={memory.status === "ai_inferred"}>
            {MEMORY_LABEL[memory.status]}
          </StatusBadge>
          {memory.temporalStatus === "historical" && <StatusBadge status="neutral">Past{memory.endedOn ? ` · until ${memory.endedOn}` : ""}</StatusBadge>}
          {memory.aiExcluded && <StatusBadge status="neutral">Not used in AI chat</StatusBadge>}
        </div>
      </div>
      {memory.status !== "superseded" && memory.aiExcluded !== undefined && (
        <Button
          variant="link"
          size="sm"
          className="h-auto"
          disabled={pending}
          aria-label={memory.aiExcluded ? `Use in AI chat: ${memory.fact}` : `Don't use in AI chat: ${memory.fact}`}
          onClick={() => start(async () => void (await setMemoryAiExcluded(memory.id, !memory.aiExcluded)))}
        >
          {memory.aiExcluded ? "Use in chat" : "Don't use in chat"}
        </Button>
      )}
      {memory.status === "ai_inferred" && (
        <Button variant="link" size="sm" className="h-auto" disabled={pending} onClick={() => start(async () => void (await confirmMemory(memory.id)))}>
          <Check aria-hidden /> Confirm
        </Button>
      )}
      <button
        type="button"
        disabled={pending}
        aria-label={`Forget: ${memory.fact}`}
        onClick={() => start(async () => void (await deleteMemory(memory.id)))}
        className="rounded-md p-2 text-text-muted hover:bg-error-soft hover:text-error disabled:opacity-50"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </li>
  );
}

export function AddMemoryForm() {
  const [state, action, pending] = useActionState(addMemory, {});
  return (
    <form action={action} key={state.ok} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Input label="Something the assistant should keep in mind" name="fact" placeholder="e.g. I work night shifts" />
        <Button type="submit" variant="soft" disabled={pending}>
          Add
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
