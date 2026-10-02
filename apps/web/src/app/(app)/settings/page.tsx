import type { ConsentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { Bell, ChevronRight, Download, KeyRound } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { StateView } from "@/components/ui/state-view";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { ConsentToggle } from "@/features/settings/consent-toggle";
import { DeleteAccountForm } from "@/features/settings/delete-account-form";
import { DisplayForm } from "@/features/settings/display-form";
import { getAccount } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";
import { getDisplayPrefs } from "@/lib/display-prefs.server";
import { isPreviewMode } from "@/lib/preview/mode";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const CONSENTS = [
  { kind: "ai_processing", title: "AI Health Assistant", description: "Send your messages and saved health details to our AI provider to answer you." },
  { kind: "document_processing", title: "Report & photo analysis", description: "Send files you upload to our AI provider for a plain-language summary." },
  { kind: "health_data_sync", title: "Health data sync", description: "Store Apple Health measurements you choose in your account (set up in the iPhone app). They reach the AI only if AI Health Assistant is also on." },
] as const;

export default async function SettingsPage() {
  const [consents, prefs, account] = await Promise.all([
    api<ConsentRecord[]>("me/consents").catch((error) => {
      if (error instanceof ApiError && error.status !== 401) return error;
      throw error;
    }),
    getDisplayPrefs(),
    getAccount().catch(() => null),
  ]);
  const granted = (kind: string) => !(consents instanceof ApiError) && consents.some((c) => c.kind === kind && c.granted);
  return (
    <>
      <PageHeader title="Settings" description="Notifications, display, privacy, your data and your account." />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Link href="/settings/notifications" className="flex items-center gap-3 rounded-lg bg-card p-5 shadow-card ring-1 ring-separator/60 hover:bg-card-muted">
            <IconBadge icon={<Bell />} tone="orange" />
            <span className="min-w-0 flex-1">
              <span className="block text-card-title text-text-primary">Notifications</span>
              <span className="block text-caption text-text-secondary">Reminders, alerts, lock-screen privacy and quiet hours</span>
            </span>
            <ChevronRight aria-hidden className="size-5 text-text-muted" />
          </Link>
          <Card as="section" aria-labelledby="display">
            <h2 id="display" className="mb-4 text-card-title text-text-primary">
              Display
            </h2>
            <DisplayForm prefs={prefs} />
          </Card>
          <Card as="section" aria-labelledby="privacy">
            <h2 id="privacy" className="text-card-title text-text-primary">
              Privacy
            </h2>
            <p className="mt-1 text-caption text-text-secondary">Turning a switch off stops new processing right away. Your data is never sold or used for advertising.</p>
            {consents instanceof ApiError ? (
              <StateView
                compact
                state={consents.code === "network" ? "offline" : "error"}
                title={consents.code === "network" ? undefined : "Your privacy choices couldn't load"}
                action={
                  <Link href="/settings" prefetch={false} className="text-caption font-semibold text-primary hover:underline">
                    Try again
                  </Link>
                }
              />
            ) : (
              <div className="mt-2 divide-y divide-separator">
                {CONSENTS.map((c) => (
                  <ConsentToggle key={c.kind} kind={c.kind} title={c.title} description={c.description} granted={granted(c.kind)} />
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="your-data">
            <h2 id="your-data" className="text-card-title text-text-primary">
              Your data
            </h2>
            <p className="mt-1 mb-4 text-caption text-text-secondary">
              Download everything HealthMate holds about you — profile, health readings, plan, timeline, conversations, reports and care details — as a JSON file.
            </p>
            <a href="/settings/export" className={buttonVariants({ variant: "secondary" })} download>
              <Download aria-hidden /> Download my data
            </a>
          </Card>
          <Card as="section" aria-labelledby="account">
            <h2 id="account" className="mb-4 text-card-title text-text-primary">
              Account
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/settings/account" className={buttonVariants({ variant: "secondary" })}>
                <KeyRound aria-hidden /> Account & password
              </Link>
              <SignOutButton />
            </div>
          </Card>
          <Card as="section" aria-labelledby="about">
            <h2 id="about" className="mb-2 text-card-title text-text-primary">
              About
            </h2>
            <p className="text-caption text-text-secondary">
              HealthMate is an AI health companion, not a doctor. It helps you understand and organise your health information; it doesn&apos;t diagnose or treat.
              {isPreviewMode() ? " You're using Preview mode: everything here is sample data." : ""}
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-body">
              {[
                ["/help", "Help & support"],
                ["/help#privacy", "Privacy policy"],
                ["/help#terms", "Terms of use"],
                ["/design", "Design system"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href!} className="font-semibold text-primary hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card as="section" aria-labelledby="delete" className="ring-1 ring-error/30">
            <h2 id="delete" className="mb-3 text-card-title text-error">
              Delete account
            </h2>
            <DeleteAccountForm hasPassword={!account || account.signInMethods.includes("password")} />
          </Card>
        </div>
      </div>
    </>
  );
}
