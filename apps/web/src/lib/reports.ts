import type { DocumentRecord, ReportFinding } from "@healthmate/shared-types";
import { documentTitle } from "@/features/reports/labels";

/** Reports & photos list filters, the same on iOS (HealthMateCore `DocumentFilter`). */
export const REPORT_FILTERS = [
  { id: "all", label: "All", emptyTitle: "No reports yet", empty: "Upload a lab report to see each result explained in plain language, with questions to ask your doctor." },
  { id: "reports", label: "Reports", emptyTitle: "No reports yet", empty: "Upload a lab report to see each result explained in plain language, with questions to ask your doctor." },
  { id: "photos", label: "Photos", emptyTitle: "No photos yet", empty: "Check a photo of a skin concern, cut or swelling to see what's visible and what to watch for." },
] as const;

export type ReportFilter = (typeof REPORT_FILTERS)[number];

export function reportFilter(id: string | undefined): ReportFilter {
  return REPORT_FILTERS.find((f) => f.id === id) ?? REPORT_FILTERS[0];
}

/** Documents the filter shows whose file name or title contains `query`, newest first. */
export function filterDocuments(docs: DocumentRecord[], filter: ReportFilter, query = ""): DocumentRecord[] {
  const needle = query.trim().toLowerCase();
  return docs
    .filter((d) => filter.id === "all" || d.kind === (filter.id === "reports" ? "report" : "image"))
    .filter((d) => !needle || d.filename.toLowerCase().includes(needle) || documentTitle(d).toLowerCase().includes(needle))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const PROCESSING_STEPS = ["Uploaded securely", "Reading the file", "Writing a plain-language summary"];

/** Index of the step in progress (`PROCESSING_STEPS.length` when finished). */
export function currentStep(doc: Pick<DocumentRecord, "status" | "createdAt">, now = Date.now()): number {
  switch (doc.status) {
    case "awaiting_upload":
      return 0;
    case "processing":
      return now - new Date(doc.createdAt).getTime() > 6000 ? 2 : 1;
    default:
      return PROCESSING_STEPS.length;
  }
}

const OUTSIDE = new Set<ReportFinding["flag"]>(["high", "low", "abnormal"]);

export function findingCounts(findings: ReportFinding[]) {
  return {
    within: findings.filter((f) => f.flag === "within_range").length,
    outside: findings.filter((f) => OUTSIDE.has(f.flag)).length,
    noRange: findings.filter((f) => f.flag === "not_stated").length,
  };
}

/** e.g. "4 within the report's range · 1 outside it" — compared with the printed range only. */
export function countsLine(counts: ReturnType<typeof findingCounts>): string {
  return [
    counts.within > 0 && `${counts.within} within the report's range`,
    counts.outside > 0 && `${counts.outside} outside it`,
    counts.noRange > 0 && `${counts.noRange} with no range given`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Findings outside the printed range first, otherwise in the report's order. */
export function orderedFindings(findings: ReportFinding[]): ReportFinding[] {
  return [...findings.filter((f) => OUTSIDE.has(f.flag)), ...findings.filter((f) => !OUTSIDE.has(f.flag))];
}

export function questionsText(doc: DocumentRecord, questions: string[], sample: boolean): string {
  return [
    `Questions for my doctor about ${documentTitle(doc)} (${doc.filename}):`,
    "",
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    sample ? "Sample questions from HealthMate Preview mode — not about a real report." : "Suggested by the HealthMate AI Health Assistant. Not a diagnosis.",
  ].join("\n");
}

export function askPrompt(doc: DocumentRecord): string {
  return `Can you help me understand my ${documentTitle(doc).toLowerCase()} (${doc.filename})?`;
}

export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
