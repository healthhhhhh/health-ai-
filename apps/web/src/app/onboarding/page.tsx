import type { ConsentKind, ConsentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/illustrations/logo";
import { SampleDataNotice } from "@/components/layout/sample-data-notice";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";
import { getAccount, getMeta, getProfile } from "@/lib/api/data";
import { api } from "@/lib/api/server";

export const metadata: Metadata = { title: "Set up HealthMate" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const [meta, account, { profile }, consents] = await Promise.all([getMeta(), getAccount(), getProfile(), api<ConsentRecord[]>("me/consents").catch(() => [])]);
  if (account?.onboardingCompleted) redirect("/home");
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
          defaults={{
            firstName: profile.firstName,
            lastName: profile.lastName,
            dateOfBirth: profile.dateOfBirth ?? "",
            sex: profile.sex ?? "",
            goals: profile.goals ?? [],
            consents: { ai_processing: granted("ai_processing"), document_processing: granted("document_processing"), health_data_sync: granted("health_data_sync"), voice: granted("voice") },
          }}
        />
      </main>
    </div>
  );
}
