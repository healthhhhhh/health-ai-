import type { ConsentKind, ConsentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/illustrations/logo";
import { SampleDataNotice } from "@/components/layout/sample-data-notice";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";
import { getAccount, getMeta, getProfile } from "@/lib/api/data";
import { AGE_GUARD_COOKIE } from "@/lib/age-guard";
import { api } from "@/lib/api/server";

export const metadata: Metadata = { title: "Set up HealthMate" };
export const dynamic = "force-dynamic";

/**
 * First-run setup, and where the app sends accounts whose age the server hasn't
 * confirmed (or can't serve). Only routes every account may use are called until
 * the age check has passed, so this page never bounces back to itself.
 */
export default async function OnboardingPage() {
  const [meta, account, consents] = await Promise.all([getMeta(), getAccount(), api<ConsentRecord[]>("me/consents").catch(() => [])]);
  // Older servers don't report eligibility; they don't restrict anyone by age.
  const eligibility = account?.ageEligibility ?? "eligible";
  if (account?.onboardingCompleted && eligibility === "eligible") redirect("/home");
  // An account whose age isn't confirmed can't answer the age question in a browser where the
  // server recently restricted an account (lib/age-guard). Confirmed accounts are unaffected.
  const deviceBlocked = eligibility !== "eligible" && Boolean((await cookies()).get(AGE_GUARD_COOKIE));
  // The health profile is readable only once the age check has passed.
  const profile = eligibility === "eligible" ? ((await getProfile().catch(() => null))?.profile ?? null) : null;
  const granted = (kind: ConsentKind) => consents.some((c) => c.kind === kind && c.granted);
  return (
    <div className="bg-app-gradient min-h-dvh">
      {meta?.preview && <SampleDataNotice>Preview mode — nothing here is sent anywhere. Choices are kept for this browser session only.</SampleDataNotice>}
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex justify-center text-xl">
          <Logo size={32} />
        </div>
        <OnboardingWizard
          preview={Boolean(meta?.preview)}
          restricted={eligibility === "age_review" || eligibility === "age_not_eligible" ? eligibility : deviceBlocked ? "device" : null}
          hasPassword={!account || account.signInMethods.includes("password")}
          deletionScheduled={Boolean(account?.ageDeletionScheduledAt)}
          aiRecipients={meta?.ai.recipients}
          defaults={{
            firstName: account?.firstName ?? profile?.firstName ?? "",
            lastName: account?.lastName ?? profile?.lastName ?? "",
            dateOfBirth: profile?.dateOfBirth ?? "",
            sex: profile?.sex ?? "",
            goals: profile?.goals ?? [],
            consents: { ai_processing: granted("ai_processing"), document_processing: granted("document_processing"), health_data_sync: granted("health_data_sync"), voice: granted("voice") },
          }}
        />
      </main>
    </div>
  );
}
