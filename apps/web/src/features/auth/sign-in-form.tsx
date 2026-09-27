"use client";

import { Info } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateSignIn, type SignInErrors } from "./validation";

/**
 * Sign-in form UI with client-side validation. Authentication itself arrives in
 * Phase 2 (managed identity provider behind the shared API); until then a valid
 * submission explains that and offers demo mode instead of pretending to sign in.
 */
export function SignInForm() {
  const [errors, setErrors] = useState<SignInErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = validateSignIn({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
    setErrors(next);
    setSubmitted(Object.keys(next).length === 0);
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
      <Input label="Password" name="password" type="password" autoComplete="current-password" error={errors.password} />
      <Button type="submit" size="lg" fullWidth className="mt-2">
        Sign In
      </Button>
      {submitted && (
        <div role="status" className="flex gap-2 rounded-md bg-primary-soft p-3 text-caption text-text-primary">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            Account sign-in isn&apos;t available in this preview yet.
            <ButtonLink href="/home" variant="link" size="sm" className="h-auto">
              Continue in demo mode →
            </ButtonLink>
          </div>
        </div>
      )}
    </form>
  );
}
