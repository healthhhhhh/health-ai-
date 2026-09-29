import { ChevronRight, MapPin, Phone, Stethoscope } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";

/** A clinician, clinic or pharmacy in the person's care team. */
export function ProviderCard({ name, specialty, phone, address, href, className }: { name: string; specialty?: string | null; phone?: string | null; address?: string | null; href?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card", className)}>
      <div className="flex items-start gap-3">
        <IconBadge icon={<Stethoscope />} tone="teal" />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className="text-body font-semibold text-text-primary hover:text-primary">
              {name}
            </Link>
          ) : (
            <p className="text-body font-semibold text-text-primary">{name}</p>
          )}
          {specialty && <p className="text-caption text-text-secondary">{specialty}</p>}
          {address && (
            <p className="mt-1 flex items-start gap-1 text-caption text-text-secondary">
              <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {address}
            </p>
          )}
        </div>
        {href && <ChevronRight aria-hidden className="mt-1 size-4 text-text-muted" />}
      </div>
      {phone && (
        <a href={`tel:${phone.replace(/\s+/g, "")}`} className="inline-flex h-9 items-center gap-2 self-start rounded-pill bg-primary-soft px-4 text-caption font-semibold text-primary hover:bg-primary-tint">
          <Phone aria-hidden className="size-4" /> Call {phone}
        </a>
      )}
    </div>
  );
}
