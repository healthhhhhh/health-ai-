"use client";

import type { Appointment, AppointmentRecord } from "@healthmate/shared-types";
import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import { AppointmentCard } from "@/components/ui/appointment-card";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useClientClock } from "@/hooks/use-client-clock";

/**
 * Next appointments. Uses care appointments when the server has them, otherwise
 * appointment entries from the timeline. Each opens its detail.
 */
export function UpcomingAppointments({
  appointments,
  fallback,
  serverNow,
  timeZone,
}: {
  appointments: AppointmentRecord[] | null;
  fallback: Appointment[];
  serverNow: string;
  timeZone: string;
}) {
  const { timeZone: tz } = useClientClock(serverNow, timeZone);
  const items =
    appointments?.map((a) => ({ id: a.id, title: a.title, providerName: a.providerName, startsAt: a.startsAt, mode: a.mode, location: a.location })) ??
    fallback.map((a) => ({ id: a.id, title: a.title, providerName: a.clinicianName || null, startsAt: a.startsAt, mode: a.mode, location: null }));
  return (
    <Card>
      <CardHeader
        title="Upcoming Appointments"
        action={
          <Link href="/care" className="text-caption font-semibold text-primary hover:underline underline-offset-4">
            See all
          </Link>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={<CalendarPlus />} title="No upcoming appointments" description="Appointments you add in Care appear here, with a reminder the day before." className="py-6" />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id}>
              <AppointmentCard
                title={a.title}
                providerName={a.providerName}
                startsAt={a.startsAt}
                timeZone={tz}
                mode={a.mode}
                location={a.location}
                href={appointments ? `/care/appointments/${encodeURIComponent(a.id)}` : "/timeline"}
                className="bg-card-muted shadow-none"
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
