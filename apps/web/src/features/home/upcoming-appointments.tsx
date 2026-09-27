"use client";

import type { Appointment } from "@healthmate/shared-types";
import { CalendarDays, MapPin, Video } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { useClientClock } from "@/hooks/use-client-clock";
import { formatAppointmentDate } from "@/lib/format";

export function UpcomingAppointments({ appointments, serverNow, timeZone }: { appointments: Appointment[]; serverNow: string; timeZone: string }) {
  const { timeZone: tz } = useClientClock(serverNow, timeZone);
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
      {appointments.length === 0 ? (
        <p className="text-body text-text-secondary">No upcoming appointments.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-md bg-card-muted p-3">
              <IconBadge icon={<CalendarDays />} tone="blue" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-text-primary">{a.title}</p>
                <p className="truncate text-caption text-text-secondary">
                  {a.clinicianName} · {a.specialty}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-caption font-semibold text-text-primary">{formatAppointmentDate(a.startsAt, tz)}</p>
                <p className="inline-flex items-center gap-1 text-xs text-text-secondary">
                  {a.mode === "video" ? <Video aria-hidden className="size-3.5" /> : <MapPin aria-hidden className="size-3.5" />}
                  {a.mode === "video" ? "Video visit" : "In person"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
