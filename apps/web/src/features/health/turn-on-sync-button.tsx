"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setConsent } from "@/features/chat/actions";

/** Turns on the "Health data sync" consent (it can be turned off again in Settings). */
export function TurnOnSyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setConsent("health_data_sync", true);
          if (res.ok) {
            toast({ tone: "success", title: "Health data sync is on" });
            router.refresh();
          } else toast({ tone: "error", title: "Couldn't turn it on", description: res.error });
        })
      }
    >
      {pending ? "Turning on…" : "Turn on health data sync"}
    </Button>
  );
}
