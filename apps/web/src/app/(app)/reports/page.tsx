import type { ConsentRecord, DocumentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ChevronRight, FileText, Image as ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { StateView } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocumentsConsent } from "@/features/reports/documents-consent";
import { documentTitle, statusBadge } from "@/features/reports/labels";
import { RefreshWhileProcessing } from "@/features/reports/refresh-while-processing";
import { UploadPanel } from "@/features/reports/upload-panel";
import { api, ApiError } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { isPreviewMode } from "@/lib/preview/mode";
import { byteSize, filterDocuments, REPORT_FILTERS, reportFilter } from "@/lib/reports";

export const metadata: Metadata = { title: "Medical Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ upload?: string; show?: string; q?: string }> }) {
  const { upload, show, q = "" } = await searchParams;
  // Old links to the photo upload open the dedicated photo check.
  if (upload === "photo") redirect("/reports/photo-check");
  const filter = reportFilter(show);
  const query = q.slice(0, 100);
  const loaded = await Promise.all([api<DocumentRecord[]>("documents"), api<ConsentRecord[]>("me/consents")]).catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });
  const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
  const href = (params: { show?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (params.show && params.show !== "all") search.set("show", params.show);
    if (params.q) search.set("q", params.q);
    return search.size ? `/reports?${search}` : "/reports";
  };

  if (loaded instanceof ApiError) {
    return (
      <>
        <PageHeader title="Medical Reports" description="Upload a report or check a photo and get a plain-language, AI-generated summary." />
        <Card>
          <StateView
            state={loaded.code === "network" ? "offline" : "error"}
            title={loaded.code === "network" ? undefined : "Your reports couldn't load"}
            action={
              <a href={href({ show: filter.id, q: query })} className="text-caption font-semibold text-primary hover:underline">
                Try again
              </a>
            }
          />
        </Card>
      </>
    );
  }

  const [documents, consents] = loaded;
  const hasConsent = consents.some((c) => c.kind === "document_processing" && c.granted);
  const shown = filterDocuments(documents, filter, query);

  return (
    <>
      <PageHeader title="Medical Reports" description="Upload a report or check a photo and get a plain-language, AI-generated summary." />
      <RefreshWhileProcessing active={documents.some((d) => d.status === "processing" || d.status === "awaiting_upload")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <Card as="section" aria-labelledby="upload" className="h-fit">
          <h2 id="upload" className="mb-4 text-card-title text-text-primary">
            Upload
          </h2>
          {hasConsent ? <UploadPanel /> : <DocumentsConsent />}
          {hasConsent && isPreviewMode() && (
            <p className="mt-4 rounded-md bg-card-muted p-3 text-caption text-text-secondary">
              Preview tip: files aren&apos;t analysed. Put &ldquo;blurry&rdquo; in a file name to see the unreadable result, or &ldquo;damaged&rdquo; to see a failed upload.
            </p>
          )}
        </Card>
        <Card as="section" aria-labelledby="yours" className="flex flex-col gap-3">
          <h2 id="yours" className="text-card-title text-text-primary">
            Your reports and photos
          </h2>
          {documents.length > 0 && (
            <>
              <nav aria-label="Show" className="flex gap-2">
                {REPORT_FILTERS.map((f) => (
                  <Link
                    key={f.id}
                    href={href({ show: f.id, q: query })}
                    aria-current={f.id === filter.id ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center rounded-pill px-4 text-caption font-semibold transition-colors",
                      f.id === filter.id ? "bg-primary-fill text-on-primary shadow-raised" : "bg-card text-text-secondary ring-1 ring-separator hover:text-text-primary",
                    )}
                  >
                    {f.label}
                  </Link>
                ))}
              </nav>
              <form role="search" action="/reports" className="flex h-11 items-center gap-2 rounded-md bg-card px-3 ring-1 ring-separator focus-within:ring-2 focus-within:ring-primary">
                <Search aria-hidden className="size-4 shrink-0 text-text-muted" />
                <label htmlFor="report-search" className="sr-only">
                  Search reports and photos
                </label>
                <input id="report-search" type="search" name="q" defaultValue={query} placeholder="Search by name" className="h-full min-w-0 flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none" />
                {filter.id !== "all" && <input type="hidden" name="show" value={filter.id} />}
              </form>
            </>
          )}
          {shown.length === 0 ? (
            query ? (
              <StateView
                state="empty"
                icon={<Search />}
                title={`Nothing matches “${query}”`}
                description="Try another word, or clear the search."
                action={
                  <Link href={href({ show: filter.id })} className="text-caption font-semibold text-primary hover:underline">
                    Clear search
                  </Link>
                }
              />
            ) : (
              <StateView
                state="empty"
                icon={filter.id === "photos" ? <ImageIcon /> : <FileText />}
                title={filter.emptyTitle}
                description={filter.empty}
                action={
                  filter.id !== "all" && documents.length > 0 ? (
                    <Link href="/reports" className="text-caption font-semibold text-primary hover:underline">
                      Show everything
                    </Link>
                  ) : undefined
                }
              />
            )
          ) : (
            <ul className="divide-y divide-separator">
              {shown.map((doc) => {
                const [status, label] = statusBadge(doc.status);
                return (
                  <li key={doc.id}>
                    <Link href={`/reports/${doc.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 hover:bg-card-muted">
                      <IconBadge icon={doc.kind === "report" ? <FileText /> : <ImageIcon />} tone={doc.kind === "report" ? "blue" : "purple"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold text-text-primary">{documentTitle(doc)}</p>
                        <p className="truncate text-caption text-text-secondary">
                          {doc.filename} · {byteSize(doc.byteSize)} · {date.format(new Date(doc.createdAt))}
                        </p>
                      </div>
                      <StatusBadge status={status}>{label}</StatusBadge>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
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
