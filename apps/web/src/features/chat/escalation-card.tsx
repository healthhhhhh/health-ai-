"use client";

import type { Escalation } from "@healthmate/shared-types";
import { CircleAlert, HeartHandshake, MapPin, Phone, Stethoscope, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { emergencyNumber, regionOf } from "@/lib/emergency";

const subscribe = () => () => {};

/**
 * Emergency (red) or urgent (orange) guidance with direct actions. Always
 * rendered above other content so it is never buried.
 */
export function EscalationCard({ escalation }: { escalation: Escalation }) {
  const number = useSyncExternalStore(subscribe, () => emergencyNumber(regionOf(navigator.language)), () => "112");
  const emergency = escalation.level === "emergency";
  return (
    <section
      aria-label={emergency ? "Emergency guidance" : "Urgent guidance"}
      className={cn("rounded-lg p-4 ring-2", emergency ? "bg-error-soft ring-error/50" : "bg-warning-soft ring-warning/50")}
    >
      <h3 className={cn("flex items-center gap-2 text-card-title", emergency ? "text-error" : "text-warning")}>
        {emergency ? <TriangleAlert aria-hidden className="size-5" /> : <CircleAlert aria-hidden className="size-5" />}
        {escalation.title}
      </h3>
      <p className="mt-2 text-body text-text-primary">{escalation.body}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {escalation.actions.map((action) => {
          switch (action.kind) {
            case "call_emergency":
              return (
                <a key={action.kind} href={`tel:${number}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                  <Phone aria-hidden /> {action.label} ({number})
                </a>
              );
            case "crisis_support":
              return (
                <a key={action.kind} href="https://findahelpline.com" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <HeartHandshake aria-hidden /> {action.label}
                </a>
              );
            case "find_care":
              return (
                <a key={action.kind} href="/care" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <MapPin aria-hidden /> {action.label}
                </a>
              );
            case "contact_clinician":
              return (
                <a key={action.kind} href="/care" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <Stethoscope aria-hidden /> {action.label}
                </a>
              );
          }
        })}
      </div>
    </section>
  );
}
