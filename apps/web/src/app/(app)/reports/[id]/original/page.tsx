import type { DocumentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SampleContentLabel } from "@/components/ui/content-labels";
import { StateView } from "@/components/ui/state-view";
import { documentTitle } from "@/features/reports/labels";
import { api, ApiError } from "@/lib/api/server";
import { isPreviewMode } from "@/lib/preview/mode";
import { byteSize } from "@/lib/reports";

export const metadata: Metadata = { title: "Original file" };
export const dynamic = "force-dynamic";

/** The uploaded file itself, shown in the app through a short-lived signed link. */
export default async function OriginalFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await api<DocumentRecord>(`documents/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    if (e instanceof ApiError && e.status !== 401) return e;
    throw e;
  });
  const back = (
    <Link href={`/reports/${encodeURIComponent(id)}`} className="flex items-center gap-1 text-caption font-semibold text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Back to the summary
    </Link>
  );

  if (doc instanceof ApiError) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        {back}
        <Card>
          <StateView state={doc.code === "network" ? "offline" : "error"} title={doc.code === "network" ? undefined : "The file couldn't load"} />
        </Card>
      </div>
    );
  }

  const file = `/reports/${doc.id}/file`;
  const isPdf = doc.contentType === "application/pdf";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {back}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-page-heading text-text-primary">Original file</h1>
          <p className="truncate text-caption text-text-secondary">
            {documentTitle(doc)} · {doc.filename} · {byteSize(doc.byteSize)}
          </p>
        </div>
        <a href={file} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <ExternalLink aria-hidden /> Open in a new tab
        </a>
      </div>
      {isPreviewMode() && <SampleContentLabel>Preview mode doesn&apos;t keep uploaded files, so this shows an example file — not your upload.</SampleContentLabel>}
      {doc.status === "awaiting_upload" ? (
        <Card>
          <StateView state="empty" title="The file hasn't finished uploading" description="Go back and upload it again." />
        </Card>
      ) : isPdf ? (
        <iframe src={file} title={`Original file: ${doc.filename}`} className="h-[75vh] w-full rounded-lg bg-card ring-1 ring-separator" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link to a private file
        <img src={file} alt={`Original file: ${doc.filename}`} className="mx-auto max-h-[75vh] rounded-lg bg-card object-contain ring-1 ring-separator" />
      )}
      <p className="text-caption text-text-secondary">The link to this file expires after a few minutes and only works for your account.</p>
    </div>
  );
}
