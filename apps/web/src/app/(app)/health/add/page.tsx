import type { MeasurementKind } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, Smartphone } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AddReadingForm } from "@/features/health/add-reading-form";
import { getProfile } from "@/lib/api/data";
import { dayIn } from "@/lib/plan";
import { getDisplayPrefs } from "@/lib/display-prefs.server";

export const metadata: Metadata = { title: "Add a reading" };

export default async function AddReadingPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const [{ kind }, { profile }] = await Promise.all([searchParams, getProfile()]);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link href="/health" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Health
      </Link>
      <div>
        <h1 className="text-page-heading text-text-primary">Add a reading</h1>
        <p className="mt-1 text-body text-text-secondary">Record a reading yourself. It&apos;s saved to that day in your health history and labelled &ldquo;Added by you&rdquo;.</p>
      </div>
      <Card>
        <AddReadingForm today={dayIn(new Date(), profile.timeZone)} initialKind={kind as MeasurementKind | undefined} units={(await getDisplayPrefs()).units} />
      </Card>
      <p className="flex items-start gap-2 text-caption text-text-secondary">
        <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        Readings from Apple Health sync automatically from the HealthMate iPhone app.
      </p>
    </div>
  );
}
