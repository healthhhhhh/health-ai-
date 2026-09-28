"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAccount, type DeleteState } from "./actions";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-body text-text-primary">
        This permanently deletes your account, health profile, memories, conversations, reports, plan and synced health data. It can&apos;t be undone.
      </p>
      <Input label="Password" name="password" type="password" autoComplete="current-password" />
      <label className="flex items-center gap-2 text-caption text-text-primary">
        <input type="checkbox" name="confirm" className="size-4" /> I understand this can&apos;t be undone
      </label>
      {state.error && (
        <p role="alert" className="text-caption font-medium text-error">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start text-error ring-error/40 hover:bg-error-soft">
        {pending ? "Deleting…" : "Delete everything"}
      </Button>
    </form>
  );
}
