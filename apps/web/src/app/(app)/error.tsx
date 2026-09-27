"use client";

import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<CloudOff />}
      tone="orange"
      title="We couldn't load this page"
      description="Your health data is safe. Check your connection and try again."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
