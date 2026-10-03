import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { supportEmail } from "@/lib/support";

export const metadata: Metadata = { title: "Help & Support" };
// Reads HEALTHMATE_SUPPORT_EMAIL when the page is served, not when it is built.
export const dynamic = "force-dynamic";

export default function HelpPage() {
  const email = supportEmail();
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
            Your health data belongs to you. You can download, correct and delete it in Settings. We never sell health data. The full Privacy Policy will be published before launch.
          </p>
        </Card>
        <Card as="section" aria-labelledby="contact">
          <h2 id="contact" className="text-section-heading">Contact us</h2>
          {email ? (
            <p className="mt-2 text-body text-text-secondary">
              Email{" "}
              <a href={`mailto:${email}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                {email}
              </a>{" "}
              from the address you sign in with — for example if a date of birth was entered by mistake. Please don&apos;t send health details or
              documents by email.
            </p>
          ) : (
            <p className="mt-2 text-body text-text-secondary">The support email address will be published here before launch.</p>
          )}
          <p className="mt-2 text-caption text-text-secondary">If you&apos;re in danger or thinking about hurting yourself, call or text 988, or call 911.</p>
        </Card>
      </div>
    </>
  );
}
