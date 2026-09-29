import type { Metadata } from "next";
import { ArrowLeft, CalendarPlus, ExternalLink, MapPin, Navigation, Pencil, Phone, Stethoscope } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppointmentCard } from "@/components/ui/appointment-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { RemoveProviderButton } from "@/features/care/remove-provider-button";
import { ApiError } from "@/lib/api/server";
import { splitAppointments } from "@/lib/care";

export const metadata: Metadata = { title: "Care team member" };
export const dynamic = "force-dynamic";

/** One person or place in the care team: contact actions, notes and appointments with them. */
export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const care = await loadCare();
  const back = (
    <Link href="/care/team" className="inline-flex items-center gap-1 text-caption font-semibold text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Care team
    </Link>
  );
  if (care instanceof ApiError) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        {back}
        <CareError error={care} retry={`/care/team/${encodeURIComponent(id)}`} />
      </div>
    );
  }
  const p = care.providers.find((x) => x.id === id);
  if (!p) notFound();
  const { upcoming, past } = splitAppointments(care.appointments.filter((a) => a.careProviderId === p.id));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        {back}
        <Link href={`/care/team/${p.id}/edit`} className={buttonVariants({ variant: "secondary", size: "sm", className: "ml-auto" })}>
          <Pencil aria-hidden /> Edit
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <IconBadge icon={<Stethoscope />} tone="teal" size="lg" />
        <div>
          <h1 className="text-page-heading text-text-primary">{p.name}</h1>
          {p.specialty && <p className="text-body text-text-secondary">{p.specialty}</p>}
        </div>
      </div>
      <Card as="section" aria-label="Contact" className="flex flex-col gap-4">
        {p.address && (
          <p className="flex items-start gap-3 text-body text-text-primary">
            <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" /> {p.address}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {p.phone && (
            <a href={`tel:${p.phone.replace(/\s+/g, "")}`} className={buttonVariants({ size: "sm" })}>
              <Phone aria-hidden /> Call {p.phone}
            </a>
          )}
          {p.address && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Navigation aria-hidden /> Directions<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <ExternalLink aria-hidden /> Website<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        {!p.phone && !p.address && !p.website && <p className="text-caption text-text-secondary">No contact details yet. Add them with Edit.</p>}
        {p.notes && (
          <div className="rounded-md bg-card-muted p-3">
            <p className="text-caption font-semibold text-text-secondary">Your notes</p>
            <p className="mt-1 text-body whitespace-pre-line text-text-primary">{p.notes}</p>
          </div>
        )}
      </Card>
      <section aria-labelledby="with" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="with" className="text-card-title text-text-primary">
            Appointments
          </h2>
          <Link href={`/care/appointments/new?provider=${p.id}`} className={buttonVariants({ variant: "soft", size: "sm" })}>
            <CalendarPlus aria-hidden /> Add appointment
          </Link>
        </div>
        {upcoming.length + past.length === 0 ? (
          <p className="text-caption text-text-secondary">No appointments with {p.name} yet.</p>
        ) : (
          [...upcoming, ...past.slice(0, 5)].map((a) => (
            <AppointmentCard key={a.id} title={a.title} providerName={a.providerName} startsAt={a.startsAt} timeZone={care.timeZone} mode={a.mode} location={a.location} status={a.status} href={`/care/appointments/${a.id}`} />
          ))
        )}
      </section>
      <div>
        <RemoveProviderButton id={p.id} name={p.name} />
      </div>
    </div>
  );
}
