"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StateView } from "@/components/ui/state-view";

/** A Home section that failed to load, while the rest of Home still works. */
export function SectionError({ what }: { what: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <StateView
      state="error"
      compact
      title={`Couldn't load ${what}`}
      description="The rest of Home is up to date. Try again in a moment."
      action={
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(() => router.refresh())}>
          <RefreshCw aria-hidden /> {pending ? "Trying…" : "Try again"}
        </Button>
      }
    />
  );
}
