"use client";

import { Phone } from "lucide-react";
import { useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { emergencyNumber, regionOf } from "@/lib/emergency";

const subscribe = () => () => {};

export function EmergencyCallBanner() {
  const number = useSyncExternalStore(subscribe, () => emergencyNumber(regionOf(navigator.language)), () => "112");
  return (
    <a href={`tel:${number}`} className="flex items-center gap-3 rounded-lg bg-error-soft px-5 py-4 text-error ring-2 ring-error/50">
      <Phone aria-hidden className="size-5" />
      <span className="text-card-title">In an emergency, call {number} now</span>
    </a>
  );
}

const SEARCHES = [
  { label: "Emergency departments", query: "hospital emergency room" },
  { label: "Urgent care", query: "urgent care clinic" },
  { label: "Doctors", query: "doctor" },
  { label: "Pharmacies", query: "pharmacy" },
];

/** Opens a map search near the person. HealthMate doesn't see their location. */
export function CareSearchLinks() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {SEARCHES.map((s) => (
        <li key={s.label}>
          <a
            href={`https://www.google.com/maps/search/${encodeURIComponent(`${s.query} near me`)}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "secondary", fullWidth: true })}
          >
            {s.label} near me
          </a>
        </li>
      ))}
    </ul>
  );
}
