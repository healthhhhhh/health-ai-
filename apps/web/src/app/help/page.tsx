import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";

export const metadata: Metadata = { title: "Help & Support" };

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Help & Support" description="How HealthMate works and how we handle your data." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="about">
          <h2 id="about" className="text-section-heading">What HealthMate is</h2>
          <p className="mt-2 text-body text-text-secondary">
            HealthMate is an AI health companion. It helps you understand health information, track your health, make sense of medical reports and
            keep up with instructions from your own clinicians. It is not a doctor and does not diagnose or prescribe.
          </p>
          <Disclaimer className="mt-4" />
        </Card>
        <Card as="section" aria-labelledby="terms">
          <h2 id="terms" className="text-section-heading">Terms</h2>
          <p className="mt-2 text-body text-text-secondary">The full Terms of Service will be published before launch.</p>
          <h2 id="privacy" className="mt-6 text-section-heading">Privacy</h2>
          <p className="mt-2 text-body text-text-secondary">
            Your health data belongs to you. You&apos;ll be able to export, correct and delete it. We never sell health data. The full Privacy Policy will be published before launch.
          </p>
        </Card>
      </div>
    </>
  );
}
