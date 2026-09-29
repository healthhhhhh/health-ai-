import type { AnalysisResult, DocumentRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, Camera, Eye, FileSearch, FileUp, ListChecks, MessageCircle, ShieldAlert, Sparkles, Stethoscope, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AIGeneratedLabel, SampleContentLabel } from "@/components/ui/content-labels";
import { StateView } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepProgress } from "@/components/ui/step-progress";
import { EscalationCard } from "@/features/chat/escalation-card";
import { DeleteDocumentButton } from "@/features/reports/delete-document-button";
import { documentTitle, findingFlag } from "@/features/reports/labels";
import { QuestionsCard } from "@/features/reports/questions-card";
import { RefreshWhileProcessing } from "@/features/reports/refresh-while-processing";
import { api, ApiError } from "@/lib/api/server";
import { CAPTURE_TIPS, photoCheckHref } from "@/lib/photo-check";
import { askPrompt, byteSize, countsLine, currentStep, findingCounts, orderedFindings, PROCESSING_STEPS, questionsText } from "@/lib/reports";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await api<DocumentRecord>(`documents/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    if (e instanceof ApiError && e.status !== 401) return e;
    throw e;
  });

  if (doc instanceof ApiError) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <BackLink />
        <Card>
          <StateView
            state={doc.code === "network" ? "offline" : "error"}
            title={doc.code === "network" ? undefined : "This report couldn't load"}
            action={
              <a href={`/reports/${encodeURIComponent(id)}`} className="text-caption font-semibold text-primary hover:underline">
                Try again
              </a>
            }
          />
        </Card>
      </div>
    );
  }

  const processing = doc.status === "processing" || doc.status === "awaiting_upload";
  const sample = doc.result?.model === "sample";
  const uploadAgain = doc.kind === "image" ? photoCheckHref(doc.purpose, true) : "/reports";
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
  const unreadable = doc.status === "ready" && doc.result?.type === "report" && doc.result.readable === false;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <RefreshWhileProcessing active={processing} />
      <div className="flex items-center gap-3">
        <BackLink />
        <div className="ml-auto flex items-center gap-2">
          {doc.status !== "awaiting_upload" && (
            <Link href={`/reports/${doc.id}/original`} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-caption font-semibold text-primary ring-1 ring-separator hover:bg-primary-soft">
              <FileSearch aria-hidden className="size-4" /> Original file
            </Link>
          )}
          <DeleteDocumentButton id={doc.id} />
        </div>
      </div>
      <div>
        <h1 className="text-page-heading text-text-primary">{documentTitle(doc)}</h1>
        <p className="text-caption text-text-secondary">
          {doc.filename} · {byteSize(doc.byteSize)} · uploaded {date.format(new Date(doc.createdAt))}
        </p>
      </div>

      {processing && (
        <Card className="flex flex-col gap-5" role="status" aria-live="polite">
          <div>
            <p className="text-section-heading text-text-primary">Reading your {doc.kind === "report" ? "report" : "photo"}…</p>
            <p className="text-body text-text-secondary">This usually takes under a minute. You can leave this page — we&apos;ll send a notification when it&apos;s ready.</p>
          </div>
          <StepProgress steps={PROCESSING_STEPS.map((label) => ({ label }))} current={currentStep(doc, new Date().getTime())} label="Analysis progress" />
        </Card>
      )}
      {(doc.status === "failed" || unreadable) && (
        <Card>
          <StateView
            state="error"
            title={doc.status === "failed" ? "We couldn't analyse this file" : "We couldn't read this report"}
            description={doc.status === "failed" ? (doc.failureReason ?? "Please try uploading it again.") : (doc.result?.summary ?? "Try a clearer photo or the original PDF.")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={uploadAgain} className={buttonVariants({ size: "sm" })}>
                  <FileUp aria-hidden /> Upload again
                </Link>
                <Link href={`/reports/${doc.id}/original`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <FileSearch aria-hidden /> Check the original
                </Link>
              </div>
            }
          />
          <ul className="mx-auto mt-2 max-w-md list-disc pl-5 text-caption text-text-secondary">
            <li>Upload the original PDF if you have it.</li>
            <li>For a photo, lay the page flat in good light and include the whole page.</li>
            <li>Password-protected files can&apos;t be read — save an unprotected copy first.</li>
          </ul>
        </Card>
      )}
      {doc.status === "ready" && doc.result && !unreadable && (
        <>
          {/* Urgent guidance always comes first. */}
          {doc.result.type === "image" && <UrgentGuidance level={doc.result.careUrgency} />}
          {sample && <SampleContentLabel>Sample result in Preview mode — this file wasn&apos;t analysed and nothing here is about you.</SampleContentLabel>}
          {doc.result.injectionDetected && (
            <p className="flex gap-2 rounded-md bg-warning-soft p-3 text-caption text-text-primary">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              This file contained text that looked like instructions to the AI. It was ignored and only the medical content was read.
            </p>
          )}
          {doc.result.type === "report" ? <ReportResult doc={doc} result={doc.result} sample={sample} /> : <ImageResult doc={doc} result={doc.result} sample={sample} />}
          {sample ? (
            <p className="text-xs text-text-muted">Sample content for Preview mode · {date.format(new Date(doc.processedAt ?? doc.createdAt))}. Not a diagnosis.</p>
          ) : (
            <AIGeneratedLabel basedOn={`${doc.filename}, read ${date.format(new Date(doc.processedAt ?? doc.createdAt))}`} />
          )}
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/reports" className="flex items-center gap-1 text-caption font-semibold text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Reports
    </Link>
  );
}

function ReportResult({ doc, result, sample }: { doc: DocumentRecord; result: AnalysisResult; sample: boolean }) {
  const findings = orderedFindings(result.findings ?? []);
  const counts = countsLine(findingCounts(findings));
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
      {findings.length > 0 && (
        <section aria-labelledby="results" className="flex flex-col gap-3">
          <div>
            <h2 id="results" className="text-section-heading text-text-primary">
              Results
            </h2>
            <p className="text-caption text-text-secondary">
              {findings.length} results · {counts}. Compared only with the range printed on this report — tap a result for its explanation.
            </p>
          </div>
          {findings.map((f) => {
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
        <QuestionsCard
          questions={result.suggestedQuestions!}
          text={questionsText(doc, result.suggestedQuestions!, sample)}
          filename={doc.filename}
          askHref={`/chat?q=${encodeURIComponent(askPrompt(doc))}`}
        />
      )}
    </>
  );
}

function UrgentGuidance({ level }: { level: AnalysisResult["careUrgency"] }) {
  if (level !== "urgent" && level !== "emergency") return null;
  return (
    <EscalationCard
      escalation={
        level === "emergency"
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
  );
}

function ImageResult({ doc, result, sample }: { doc: DocumentRecord; result: AnalysisResult; sample: boolean }) {
  const retakeNeeded = result.quality === "poor" || result.supported === false;
  return (
    <>
      <figure className="flex items-center gap-4 rounded-lg bg-card p-3 ring-1 ring-separator">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link to a private file */}
        <img src={`/reports/${doc.id}/file`} alt={sample ? "Example image (Preview mode doesn't keep photos)" : `Your photo: ${documentTitle(doc).toLowerCase()}`} className="size-20 shrink-0 rounded-md bg-card-muted object-cover" />
        <figcaption className="min-w-0 text-caption text-text-secondary">
          <span className="block text-body font-semibold text-text-primary">{result.bodyArea ?? documentTitle(doc)}</span>
          {documentTitle(doc)}
          {sample ? " · example image" : ""}
        </figcaption>
      </figure>
      {retakeNeeded ? (
        <Card>
          <StateView
            state="error"
            icon={<Eye />}
            title={result.supported === false ? "We can't assess this kind of photo" : "The photo isn't clear enough"}
            description={result.qualityIssue ?? "Try again in good light, holding the camera steady and close."}
            action={
              result.supported === false ? (
                <Link href="/care" className={buttonVariants({ size: "sm" })}>
                  Find care
                </Link>
              ) : (
                <Link href={photoCheckHref(doc.purpose, true)} className={buttonVariants({ size: "sm" })}>
                  <Camera aria-hidden /> Retake photo
                </Link>
              )
            }
          />
          {result.supported !== false && (
            <ul className="mx-auto mt-2 max-w-md list-disc pl-5 text-caption text-text-secondary">
              {CAPTURE_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
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
      <nav aria-label="Next steps" className="flex flex-wrap gap-2">
        <Link href={photoCheckHref(doc.purpose)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <Camera aria-hidden /> Check another photo
        </Link>
        <Link href={`/chat?q=${encodeURIComponent(askPrompt(doc))}`} className={buttonVariants({ variant: "soft", size: "sm" })}>
          <MessageCircle aria-hidden /> Ask the AI Health Assistant
        </Link>
        <Link href="/care" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <Stethoscope aria-hidden /> Find care
        </Link>
      </nav>
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
