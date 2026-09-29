import type { AppointmentRecord, CareProviderRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, CalendarPlus, Clock, ListChecks, MapPin, MessageCircle, Navigation, Pencil, Phone, Video } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { ProviderCard } from "@/components/ui/provider-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CancelAppointmentButton } from "@/features/care/cancel-appointment-button";
import { MarkCompletedButton } from "@/features/care/mark-completed-button";
import { PrepChecklist } from "@/features/care/prep-checklist";
import { parsePrep } from "@/lib/care";
import { getProfile } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";

const MODE = { in_person: { label: "In person", icon: MapPin }, video: { label: "Video call", icon: Video }, phone: { label: "Phone call", icon: Phone } } as const;

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ profile }, appointment] = await Promise.all([
    getProfile(),
    api<AppointmentRecord>(`care/appointments/${encodeURIComponent(id)}`).catch((error) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }),
  ]);
  if (!appointment) notFound();
  const provider = appointment.careProviderId
    ? await api<CareProviderRecord>(`care/providers/${encodeURIComponent(appointment.careProviderId)}`).catch(() => null)
    : null;
  const tz = profile.timeZone;
  const start = new Date(appointment.startsAt);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(start);
  const minutes = appointment.endsAt ? Math.round((new Date(appointment.endsAt).getTime() - start.getTime()) / 60_000) : null;
  const upcoming = appointment.status === "scheduled" && start > new Date();
  const mode = appointment.mode ? MODE[appointment.mode] : null;
  const prep = parsePrep(appointment.notes);
  const pastButScheduled = appointment.status === "scheduled" && start <= new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/care/appointments" className="inline-flex items-center gap-1 text-caption font-semibold text-primary hover:underline">
          <ArrowLeft aria-hidden className="size-4" /> Appointments
        </Link>
        {appointment.status !== "cancelled" && (
          <Link href={`/care/appointments/${encodeURIComponent(appointment.id)}/edit`} className={buttonVariants({ variant: "secondary", size: "sm", className: "ml-auto" })}>
            <Pencil aria-hidden /> Edit
          </Link>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-heading text-text-primary">{appointment.title}</h1>
          {appointment.status === "cancelled" && <StatusBadge status="neutral">Cancelled</StatusBadge>}
          {appointment.status === "completed" && <StatusBadge status="success">Completed</StatusBadge>}
          {upcoming && <StatusBadge status="info">Upcoming</StatusBadge>}
        </div>
        {appointment.providerName && <p className="mt-1 text-body text-text-secondary">With {appointment.providerName}</p>}
      </div>

      <Card as="section" aria-label="When and where" className="flex flex-col gap-4">
        <p className="flex items-start gap-3 text-body text-text-primary">
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <span className="block font-semibold">{date}</span>
            <span className="text-text-secondary">
              {time}
              {minutes ? ` · ${minutes} min` : ""}
            </span>
          </span>
        </p>
        {mode && (
          <p className="flex items-start gap-3 text-body text-text-primary">
            <mode.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              <span className="block font-semibold">{mode.label}</span>
              {appointment.location && <span className="text-text-secondary">{appointment.location}</span>}
            </span>
          </p>
        )}
        {prep.notes && (
          <div className="rounded-md bg-card-muted p-3">
            <p className="text-caption font-semibold text-text-secondary">Your notes</p>
            <p className="mt-1 text-body whitespace-pre-line text-text-primary">{prep.notes}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {appointment.status !== "cancelled" && (
            <a href={`/care/appointments/${encodeURIComponent(appointment.id)}/calendar`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <CalendarPlus aria-hidden /> Add to calendar
            </a>
          )}
          {appointment.location && appointment.mode === "in_person" && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.location)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Navigation aria-hidden /> Directions<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </Card>

      {appointment.status !== "cancelled" && (
        <Card as="section" aria-labelledby="prepare" className="flex flex-col gap-4">
          <div>
            <h2 id="prepare" className="flex items-center gap-2 text-card-title text-text-primary">
              <ListChecks aria-hidden className="size-5 text-primary" /> Questions to ask
            </h2>
            <p className="text-caption text-text-secondary">{upcoming ? "Write them down now and tick them off during the visit." : "What you planned to ask at this visit."}</p>
          </div>
          <PrepChecklist id={appointment.id} notes={prep.notes} initial={prep.questions} />
          {upcoming && (
            <ButtonLink href={`/chat?q=${encodeURIComponent(`Help me prepare questions for my appointment: ${appointment.title}.`)}`} variant="soft" className="self-start">
              <MessageCircle aria-hidden /> Prepare with the AI Health Assistant
            </ButtonLink>
          )}
        </Card>
      )}

      {provider && (
        <section aria-labelledby="provider-heading" className="flex flex-col gap-3">
          <h2 id="provider-heading" className="text-card-title text-text-primary">
            Provider
          </h2>
          <ProviderCard name={provider.name} specialty={provider.specialty} phone={provider.phone} address={provider.address} href={`/care/team/${provider.id}`} />
        </section>
      )}

      {(upcoming || pastButScheduled) && (
        <div className="flex flex-wrap gap-2">
          {pastButScheduled && <MarkCompletedButton id={appointment.id} />}
          {upcoming && <CancelAppointmentButton id={appointment.id} title={appointment.title} />}
        </div>
      )}
      <Disclaimer>HealthMate keeps your own record of appointments. For changes, contact the clinic directly.</Disclaimer>
    </div>
  );
}
