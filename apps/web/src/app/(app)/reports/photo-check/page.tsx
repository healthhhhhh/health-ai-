import type { ConsentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { DocumentsConsent } from "@/features/reports/documents-consent";
import { PhotoCheckFlow } from "@/features/reports/photo-check-flow";
import { getMeta } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";
import { isPreviewMode } from "@/lib/preview/mode";
import { photoPurpose } from "@/lib/photo-check";

export const metadata: Metadata = { title: "Photo check" };
export const dynamic = "force-dynamic";

export default async function PhotoCheckPage({ searchParams }: { searchParams: Promise<{ purpose?: string; retake?: string }> }) {
  const { purpose, retake } = await searchParams;
  const meta = await getMeta();
  const consents = await api<ConsentRecord[]>("me/consents").catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/reports" className="flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Reports & photos
      </Link>
      <PageHeader title="Photo check" description="Take a photo of a skin concern, a cut or wound, or swelling, and get a plain-language description of what's visible and what to watch for." />
      <Card>
        {consents instanceof ApiError ? (
          <StateView
            state={consents.code === "network" ? "offline" : "error"}
            title={consents.code === "network" ? undefined : "Photo check couldn't load"}
            action={
              <Link href="/reports/photo-check" prefetch={false} className="text-caption font-semibold text-primary hover:underline">
                Try again
              </Link>
            }
          />
        ) : consents.some((c) => c.kind === "document_processing" && c.granted) ? (
          <PhotoCheckFlow initialPurpose={photoPurpose(purpose)?.id} retake={retake === "1"} />
        ) : (
          <DocumentsConsent aiRecipients={meta?.ai.recipients} />
        )}
      </Card>
      {isPreviewMode() && (
        <p className="text-caption text-text-secondary">
          Preview tip: photos aren&apos;t analysed. Put &ldquo;blurry&rdquo; in a file name to see the retake result, or describe an emergency in the note to see urgent guidance first.
        </p>
      )}
    </div>
  );
}
