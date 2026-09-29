import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { AppointmentForm } from "@/features/care/appointment-form";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ApiError } from "@/lib/api/server";
import { dayIn } from "@/lib/plan";

export const metadata: Metadata = { title: "Add appointment" };
export const dynamic = "force-dynamic";

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const { provider } = await searchParams;
  const care = await loadCare();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/care/appointments" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Appointments
      </Link>
      <PageHeader title="Add appointment" description="Keep the time, place and what you want to ask in one place." />
      {care instanceof ApiError ? (
        <CareError error={care} retry="/care/appointments/new" />
      ) : (
        <Card>
          <AppointmentForm
            providers={care.providers}
            timeZone={care.timeZone}
            values={{ day: dayIn(new Date(), care.timeZone), time: "09:00", careProviderId: care.providers.some((p) => p.id === provider) ? provider : null }}
          />
        </Card>
      )}
    </div>
  );
}
