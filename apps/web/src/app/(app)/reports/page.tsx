import type { ConsentRecord, DocumentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { FileText, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBadge } from "@/components/ui/icon-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocumentsConsent } from "@/features/reports/documents-consent";
import { documentTitle, statusBadge } from "@/features/reports/labels";
import { RefreshWhileProcessing } from "@/features/reports/refresh-while-processing";
import { UploadPanel } from "@/features/reports/upload-panel";
import { api } from "@/lib/api/server";

export const metadata: Metadata = { title: "Medical Reports" };

export default async function ReportsPage() {
  const [documents, consents] = await Promise.all([api<DocumentRecord[]>("documents"), api<ConsentRecord[]>("me/consents")]);
  const hasConsent = consents.some((c) => c.kind === "document_processing" && c.granted);
  const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <PageHeader title="Medical Reports" description="Upload a report or a photo and get a plain-language, AI-generated summary." />
      <RefreshWhileProcessing active={documents.some((d) => d.status === "processing" || d.status === "awaiting_upload")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <Card as="section" aria-labelledby="upload" className="h-fit">
          <h2 id="upload" className="mb-4 text-card-title text-text-primary">
            Upload
          </h2>
          {hasConsent ? <UploadPanel /> : <DocumentsConsent />}
        </Card>
        <Card as="section" aria-labelledby="yours">
          <h2 id="yours" className="mb-2 text-card-title text-text-primary">
            Your reports and photos
          </h2>
          {documents.length === 0 ? (
            <EmptyState icon={<FileText />} title="No reports yet" description="Upload a lab report to see each result explained in plain language, with questions to ask your doctor." />
          ) : (
            <ul className="divide-y divide-separator">
              {documents.map((doc) => {
                const [status, label] = statusBadge(doc.status);
                return (
                  <li key={doc.id}>
                    <Link href={`/reports/${doc.id}`} className="flex items-center gap-3 rounded-md py-3 hover:bg-card-muted">
                      <IconBadge icon={doc.kind === "report" ? <FileText /> : <ImageIcon />} tone={doc.kind === "report" ? "blue" : "purple"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold text-text-primary">{documentTitle(doc)}</p>
                        <p className="text-caption text-text-secondary">{date.format(new Date(doc.createdAt))}</p>
                      </div>
                      <StatusBadge status={status}>{label}</StatusBadge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
