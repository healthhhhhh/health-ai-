import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AppointmentCard } from "@/components/ui/appointment-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ApiError } from "@/lib/api/server";
import { splitAppointments } from "@/lib/care";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const { when } = await searchParams;
  const past = when === "past";
  const care = await loadCare();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/care" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Care
      </Link>
      <PageHeader
        title="Appointments"
        description="Your own record of visits — HealthMate doesn't book or change appointments with clinics."
        actions={
          <Link href="/care/appointments/new" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden /> Add appointment
          </Link>
        }
      />
      <nav aria-label="Show" className="flex gap-2">
        {[
          ["Upcoming", "/care/appointments", !past],
          ["Past", "/care/appointments?when=past", past],
        ].map(([label, href, active]) => (
          <Link
            key={String(label)}
            href={String(href)}
            aria-current={active ? "page" : undefined}
            className={cn("inline-flex h-9 items-center rounded-pill px-4 text-caption font-semibold", active ? "bg-primary-fill text-on-primary shadow-raised" : "bg-card text-text-secondary ring-1 ring-separator hover:text-text-primary")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {care instanceof ApiError ? (
        <CareError error={care} retry={past ? "/care/appointments?when=past" : "/care/appointments"} />
      ) : (
        (() => {
          const list = splitAppointments(care.appointments)[past ? "past" : "upcoming"];
          return list.length === 0 ? (
            <Card>
              <StateView
                state="empty"
                icon={<CalendarDays />}
                title={past ? "No past appointments" : "No upcoming appointments"}
                description={past ? "Appointments move here after their time, including ones marked cancelled." : "Add one to keep the time, place and your questions together."}
              />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((a) => (
                <li key={a.id}>
                  <AppointmentCard title={a.title} providerName={a.providerName} startsAt={a.startsAt} timeZone={care.timeZone} mode={a.mode} location={a.location} status={a.status} href={`/care/appointments/${a.id}`} />
                </li>
              ))}
            </ul>
          );
        })()
      )}
    </div>
  );
}
