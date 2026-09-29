import type { Metadata } from "next";
import { CalendarDays, Plus, Stethoscope } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AppointmentCard } from "@/components/ui/appointment-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { ProviderCard } from "@/components/ui/provider-card";
import { StateView } from "@/components/ui/state-view";
import { CareSearchLinks, EmergencyCallBanner } from "@/features/care-links";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ApiError } from "@/lib/api/server";
import { splitAppointments } from "@/lib/care";

export const metadata: Metadata = { title: "Care" };
export const dynamic = "force-dynamic";

/** Emergency help first, then appointments, the care team, and finding care nearby. */
export default async function CarePage() {
  const care = await loadCare();
  return (
    <>
      <PageHeader title="Care" description="Your appointments and care team, and help finding care near you." />
      <div className="flex max-w-4xl flex-col gap-6">
        <EmergencyCallBanner />
        {care instanceof ApiError ? (
          <CareError error={care} retry="/care" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card as="section" aria-labelledby="appointments" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="appointments" className="text-card-title text-text-primary">
                  Upcoming appointments
                </h2>
                <Link href="/care/appointments" className="text-caption font-semibold text-primary hover:underline">
                  See all
                </Link>
              </div>
              {(() => {
                const { upcoming } = splitAppointments(care.appointments);
                return upcoming.length === 0 ? (
                  <StateView state="empty" compact icon={<CalendarDays />} title="No upcoming appointments" description="Add one to keep the time, place and your questions together." />
                ) : (
                  upcoming.slice(0, 3).map((a) => (
                    <AppointmentCard key={a.id} title={a.title} providerName={a.providerName} startsAt={a.startsAt} timeZone={care.timeZone} mode={a.mode} location={a.location} status={a.status} href={`/care/appointments/${a.id}`} />
                  ))
                );
              })()}
              <Link href="/care/appointments/new" className={buttonVariants({ variant: "soft", size: "sm", className: "self-start" })}>
                <Plus aria-hidden /> Add appointment
              </Link>
            </Card>
            <Card as="section" aria-labelledby="team" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="team" className="text-card-title text-text-primary">
                  Your care team
                </h2>
                <Link href="/care/team" className="text-caption font-semibold text-primary hover:underline">
                  See all
                </Link>
              </div>
              {care.providers.length === 0 ? (
                <StateView state="empty" compact icon={<Stethoscope />} title="No one added yet" description="Add your doctor, clinic or pharmacy to have their details in one place." />
              ) : (
                care.providers.slice(0, 3).map((p) => <ProviderCard key={p.id} name={p.name} specialty={p.specialty} phone={p.phone} href={`/care/team/${p.id}`} />)
              )}
              <Link href="/care/team/new" className={buttonVariants({ variant: "soft", size: "sm", className: "self-start" })}>
                <Plus aria-hidden /> Add to care team
              </Link>
            </Card>
          </div>
        )}
        <Card as="section" aria-labelledby="near-you">
          <h2 id="near-you" className="text-card-title text-text-primary">
            Find care near you
          </h2>
          <p className="mt-1 mb-4 text-caption text-text-secondary">
            Opens a map search in a new tab. HealthMate doesn&apos;t see your location and doesn&apos;t rank, rate or endorse providers — check opening hours before you go.
          </p>
          <CareSearchLinks />
        </Card>
        <Card as="section" aria-labelledby="crisis">
          <h2 id="crisis" className="text-card-title text-text-primary">
            If you&apos;re struggling
          </h2>
          <p className="mt-1 text-body text-text-secondary">
            If you might act on thoughts of harming yourself, call your local emergency number now. Free, confidential crisis lines are listed at{" "}
            <a href="https://findahelpline.com" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-4 hover:underline">
              findahelpline.com
            </a>
            .
          </p>
        </Card>
        <Disclaimer />
      </div>
    </>
  );
}
