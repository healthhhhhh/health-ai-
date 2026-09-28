import type { AnalysisResult, DocumentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, Eye, ListChecks, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mascot } from "@/components/illustrations/mascot";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { EscalationCard } from "@/features/chat/escalation-card";
import { DeleteDocumentButton } from "@/features/reports/delete-document-button";
import { documentTitle, findingFlag } from "@/features/reports/labels";
import { RefreshWhileProcessing } from "@/features/reports/refresh-while-processing";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await api<DocumentRecord>(`documents/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  const processing = doc.status === "processing" || doc.status === "awaiting_upload";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <RefreshWhileProcessing active={processing} />
      <div className="flex items-center gap-3">
        <Link href="/reports" className="flex items-center gap-1 text-caption font-semibold text-primary hover:underline">
          <ArrowLeft aria-hidden className="size-4" /> Reports
        </Link>
        <div className="ml-auto">
          <DeleteDocumentButton id={doc.id} />
        </div>
      </div>
      <div>
        <h1 className="text-page-heading text-text-primary">{documentTitle(doc)}</h1>
        <p className="text-caption text-text-secondary">{doc.filename}</p>
      </div>

      {processing && (
        <Card className="flex flex-col items-center gap-3 py-10 text-center" role="status">
          <Mascot size={100} decorative />
          <p className="text-section-heading text-text-primary">Reading your {doc.kind === "report" ? "report" : "photo"}…</p>
          <p className="text-body text-text-secondary">This usually takes under a minute. You can leave this page.</p>
        </Card>
      )}
      {doc.status === "failed" && (
        <Card>
          <EmptyState icon={<TriangleAlert />} tone="orange" title="We couldn't analyse this file" description={doc.failureReason ?? "Please try uploading it again."} />
        </Card>
      )}
      {doc.status === "ready" && doc.result && (
        <>
          {doc.result.injectionDetected && (
            <p className="flex gap-2 rounded-md bg-warning-soft p-3 text-caption text-text-primary">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              This file contained text that looked like instructions to the AI. It was ignored and only the medical content was read.
            </p>
          )}
          {doc.result.type === "report" ? <ReportResult result={doc.result} /> : <ImageResult result={doc.result} />}
          <p className="text-xs text-text-muted">
            AI-generated from your {doc.kind === "report" ? "report" : "photo"} on {new Date(doc.processedAt ?? doc.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}. Not a
            diagnosis.
          </p>
        </>
      )}
    </div>
  );
}

function ReportResult({ result }: { result: AnalysisResult }) {
  if (result.readable === false) {
    return (
      <Card>
        <EmptyState icon={<TriangleAlert />} tone="orange" title="We couldn't read this report" description={result.summary ?? "Try a clearer photo or the original PDF."} />
      </Card>
    );
  }
  return (
    <>
      {result.summary && (
        <section aria-labelledby="summary" className="rounded-lg bg-gradient-to-br from-purple-soft to-primary-soft p-5">
          <h2 id="summary" className="flex items-center gap-2 text-card-title text-primary">
            <Sparkles aria-hidden className="size-5" /> Summary
          </h2>
          <p className="mt-2 text-body text-text-primary">{result.summary}</p>
        </section>
      )}
      {(result.findings?.length ?? 0) > 0 && (
        <section aria-labelledby="results" className="flex flex-col gap-3">
          <h2 id="results" className="text-section-heading text-text-primary">
            Results
          </h2>
          {result.findings!.map((f) => {
            const [status, label] = findingFlag(f.flag);
            return (
              <Card key={`${f.name}-${f.value}-${f.page ?? 0}`}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-body font-semibold text-text-primary">{f.name}</span>
                    <span className="ml-auto text-body font-semibold tabular-nums">{[f.value, f.unit].filter(Boolean).join(" ")}</span>
                    <span className="flex w-full items-center gap-2">
                      <StatusBadge status={status}>{label}</StatusBadge>
                      {f.referenceRange && <span className="text-xs text-text-secondary">Range {f.referenceRange}</span>}
                      {f.page != null && <span className="ml-auto text-xs text-text-muted">Page {f.page}</span>}
                    </span>
                  </summary>
                  <p className="mt-3 text-caption text-text-secondary">{f.explanation}</p>
                </details>
              </Card>
            );
          })}
        </section>
      )}
      {(result.suggestedQuestions?.length ?? 0) > 0 && (
        <Card as="section" aria-labelledby="questions">
          <h2 id="questions" className="text-card-title text-text-primary">
            Questions to ask your doctor
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-text-primary">
            {result.suggestedQuestions!.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ImageResult({ result }: { result: AnalysisResult }) {
  const urgent = result.careUrgency === "urgent" || result.careUrgency === "emergency";
  return (
    <>
      {urgent && (
        <EscalationCard
          escalation={
            result.careUrgency === "emergency"
              ? {
                  level: "emergency",
                  title: "Get emergency help now",
                  body: "Based on what you described, call your local emergency number or go to the nearest emergency department.",
                  actions: [
                    { kind: "call_emergency", label: "Call emergency services" },
                    { kind: "find_care", label: "Find the nearest emergency department" },
                  ],
                }
              : {
                  level: "urgent",
                  title: "Please get this checked today",
                  body: "Contact a doctor or urgent-care service today. If it gets worse, call your local emergency number.",
                  actions: [
                    { kind: "contact_clinician", label: "Contact a clinician" },
                    { kind: "find_care", label: "Find urgent care" },
                  ],
                }
          }
        />
      )}
      {result.quality === "poor" || result.supported === false ? (
        <Card>
          <EmptyState
            icon={<Eye />}
            tone="orange"
            title={result.supported === false ? "We can't assess this kind of photo" : "The photo isn't clear enough"}
            description={result.qualityIssue ?? "Try again in good light, holding the camera steady and close."}
          />
        </Card>
      ) : (
        <>
          {result.bodyArea && <p className="text-section-heading text-text-primary">{result.bodyArea}</p>}
          <List title="What we can see" icon={<Eye aria-hidden className="size-5" />} items={result.observations ?? []} />
          {(result.possibleCauses?.length ?? 0) > 0 && (
            <Card as="section" aria-labelledby="causes">
              <h2 id="causes" className="text-card-title text-text-primary">
                Possible explanations
              </h2>
              <p className="text-caption text-text-secondary">Not a diagnosis — only a clinician who examines you can say what this is.</p>
              <ul className="mt-2 divide-y divide-separator">
                {result.possibleCauses!.map((c) => (
                  <li key={c.name} className="flex items-center justify-between py-2 text-body">
                    {c.name}
                    <StatusBadge status="neutral">{c.likelihood === "possible" ? "Possible" : "Less likely"}</StatusBadge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <List title="What you can do" icon={<ListChecks aria-hidden className="size-5" />} items={result.recommendations ?? []} />
        </>
      )}
      {(result.warningSigns?.length ?? 0) > 0 && (
        <section aria-labelledby="warning" className="rounded-md bg-warning-soft p-4">
          <h2 id="warning" className="flex items-center gap-2 text-caption font-semibold text-warning">
            <TriangleAlert aria-hidden className="size-4" /> Get help quickly if you notice
          </h2>
          <ul className="mt-1 list-disc pl-5 text-caption text-text-primary">
            {result.warningSigns!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function List({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card as="section" aria-label={title}>
      <h2 className="flex items-center gap-2 text-card-title text-text-primary">
        {icon} {title}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-text-primary">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Card>
  );
}
