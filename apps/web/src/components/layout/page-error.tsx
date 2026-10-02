"use client";

import { CloudOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shown by the error boundaries. "Try again" refetches the page's server data
 * (`router.refresh`) before re-rendering, so it actually retries a failed load.
 */
export function PageError({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <EmptyState
      icon={<CloudOff />}
      tone="orange"
      title="We couldn't load this page"
      description="Your health data is safe. Check your connection and try again."
      action={
        <Button
          disabled={pending}
          onClick={() =>
            start(() => {
              router.refresh();
              reset();
            })
          }
        >
          Try again
        </Button>
      }
    />
  );
}
