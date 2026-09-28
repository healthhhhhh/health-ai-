import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { CareSearchLinks, EmergencyCallBanner } from "@/features/care-links";

export const metadata: Metadata = { title: "Find Care" };

export default function CarePage() {
  return (
    <>
      <PageHeader title="Find Care" description="Get help quickly, or find a clinic, doctor or pharmacy near you." />
      <div className="flex max-w-3xl flex-col gap-6">
        <EmergencyCallBanner />
        <Card as="section" aria-labelledby="near-you">
          <h2 id="near-you" className="text-card-title text-text-primary">
            Near you
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
