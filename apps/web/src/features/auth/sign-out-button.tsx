"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { signOut } from "./actions";

/** Asks before signing out, so a stray tap doesn't end the session. */
export function SignOutButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <LogOut aria-hidden /> Sign out
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Sign out of HealthMate?"
        description="Your information stays saved in your account. You'll need your email and password (or Apple / Google) to sign back in."
        confirmLabel="Sign out"
        onConfirm={() => signOut()}
      />
    </>
  );
}
