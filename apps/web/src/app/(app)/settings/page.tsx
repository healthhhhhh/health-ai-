import type { ConsentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { Download, LogOut } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signOut } from "@/features/auth/actions";
import { ConsentToggle } from "@/features/settings/consent-toggle";
import { DeleteAccountForm } from "@/features/settings/delete-account-form";
import { api } from "@/lib/api/server";

export const metadata: Metadata = { title: "Settings" };

const CONSENTS = [
  { kind: "ai_processing", title: "AI Health Assistant", description: "Send your messages and saved health details to our AI provider to answer you." },
  { kind: "document_processing", title: "Report & photo analysis", description: "Send files you upload to our AI provider for a plain-language summary." },
  { kind: "health_data_sync", title: "Health data sync", description: "Store Apple Health measurements you choose in your account (set up in the iPhone app)." },
] as const;

export default async function SettingsPage() {
  const consents = await api<ConsentRecord[]>("me/consents");
  const granted = (kind: string) => consents.some((c) => c.kind === kind && c.granted);
  return (
    <>
      <PageHeader title="Settings" description="Privacy, your data and your account." />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card as="section" aria-labelledby="privacy">
          <h2 id="privacy" className="text-card-title text-text-primary">
            Privacy
          </h2>
          <p className="mt-1 text-caption text-text-secondary">Turning a switch off stops new processing right away. Your data is never sold or used for advertising.</p>
          <div className="mt-2 divide-y divide-separator">
            {CONSENTS.map((c) => (
              <ConsentToggle key={c.kind} kind={c.kind} title={c.title} description={c.description} granted={granted(c.kind)} />
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="your-data">
            <h2 id="your-data" className="text-card-title text-text-primary">
              Your data
            </h2>
            <p className="mt-1 mb-4 text-caption text-text-secondary">Download everything HealthMate holds about you as a JSON file.</p>
            <a href="/settings/export" className={buttonVariants({ variant: "secondary" })} download>
              <Download aria-hidden /> Download my data
            </a>
          </Card>
          <Card as="section" aria-labelledby="account">
            <h2 id="account" className="mb-4 text-card-title text-text-primary">
              Account
            </h2>
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                <LogOut aria-hidden /> Sign out
              </Button>
            </form>
          </Card>
          <Card as="section" aria-labelledby="delete" className="ring-1 ring-error/30">
            <h2 id="delete" className="mb-3 text-card-title text-error">
              Delete account
            </h2>
            <DeleteAccountForm />
          </Card>
        </div>
      </div>
    </>
  );
}
