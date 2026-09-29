"use client";

import type { CareProviderRecord } from "@healthmate/shared-types";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { saveProvider, type CareFormState } from "./actions";

/** Add or edit a clinician, clinic or pharmacy in the care team. */
export function ProviderForm({ provider }: { provider?: CareProviderRecord }) {
  const [state, action, pending] = useActionState<CareFormState, FormData>(saveProvider, {});
  const v = { ...provider, ...state.fields } as Record<string, string | null | undefined>;
  const str = (k: string) => v[k] ?? "";
  return (
    <form action={action} className="flex flex-col gap-4">
      {provider && <input type="hidden" name="id" value={provider.id} />}
      <Input label="Name" name="name" defaultValue={str("name")} placeholder="e.g. Dr. Rivera, or Riverside Health Centre" maxLength={160} required />
      <Input label="Role or specialty (optional)" name="specialty" defaultValue={str("specialty")} placeholder="e.g. Family doctor, Pharmacy" maxLength={120} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Phone (optional)" name="phone" type="tel" defaultValue={str("phone")} maxLength={40} />
        <Input label="Website (optional)" name="website" type="url" defaultValue={str("website")} placeholder="https://" maxLength={300} />
      </div>
      <Input label="Address (optional)" name="address" defaultValue={str("address")} maxLength={300} />
      <Textarea label="Notes (optional)" name="notes" defaultValue={str("notes")} rows={3} maxLength={1000} hint="e.g. opening hours, who to ask for" />
      {state.error && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : provider ? "Save changes" : "Add to care team"}
      </Button>
    </form>
  );
}
