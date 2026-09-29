import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { AppointmentForm } from "@/features/care/appointment-form";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ApiError } from "@/lib/api/server";
import { zonedParts } from "@/lib/care";

export const metadata: Metadata = { title: "Edit appointment" };
export const dynamic = "force-dynamic";

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const care = await loadCare();
  const back = (
    <Link href={`/care/appointments/${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Appointment
    </Link>
  );
  if (care instanceof ApiError) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        {back}
        <CareError error={care} retry={`/care/appointments/${encodeURIComponent(id)}/edit`} />
      </div>
    );
  }
  const a = care.appointments.find((x) => x.id === id);
  if (!a) notFound();
  const { day, time } = zonedParts(a.startsAt, care.timeZone);
  const duration = a.endsAt ? Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000) : 0;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {back}
      <PageHeader title="Edit appointment" description="Changes are saved in HealthMate only — contact the clinic to change the booking itself." />
      <Card>
        <AppointmentForm providers={care.providers} timeZone={care.timeZone} values={{ id: a.id, title: a.title, careProviderId: a.careProviderId, day, time, duration, mode: a.mode, location: a.location, notes: a.notes }} />
      </Card>
    </div>
  );
}
