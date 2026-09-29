"use client";

import { AlertCircle } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { changePassword, type ChangePasswordState } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePassword, {});
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (!state.ok) return;
    form.current?.reset();
    toast({ tone: "success", title: "Password changed", description: "Use it the next time you sign in." });
  }, [state.ok, toast]);
  return (
    <form ref={form} noValidate action={action} className="flex flex-col gap-4">
      <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" />
      <Input label="New password" name="newPassword" type="password" autoComplete="new-password" hint="At least 8 characters." />
      <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
      {state.error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
