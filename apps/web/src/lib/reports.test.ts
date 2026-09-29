import type { DocumentRecord, ReportFinding } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";
import { findingFlag } from "@/features/reports/labels";
import { byteSize, countsLine, currentStep, filterDocuments, findingCounts, orderedFindings, PROCESSING_STEPS, questionsText, reportFilter } from "./reports";

const now = Date.parse("2026-09-29T12:00:00Z");
const doc = (id: string, over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  kind: "report",
  purpose: null,
  filename: "labs.pdf",
  contentType: "application/pdf",
  byteSize: 1000,
  status: "ready",
  failureReason: null,
  result: null,
  createdAt: new Date(now).toISOString(),
  processedAt: null,
  ...over,
});
const finding = (name: string, flag: ReportFinding["flag"]): ReportFinding => ({ name, value: "1", unit: null, referenceRange: null, flag, page: 1, explanation: "" });

describe("reports", () => {
  it("filters by kind and searches names and titles, newest first", () => {
    const docs = [
      doc("a", { filename: "Blood test.pdf", createdAt: "2026-09-01T00:00:00Z" }),
      doc("b", { kind: "image", purpose: "skin", filename: "arm.jpg", createdAt: "2026-09-02T00:00:00Z" }),
      doc("c", { filename: "Letter.pdf", createdAt: "2026-09-03T00:00:00Z" }),
    ];
    expect(filterDocuments(docs, reportFilter(undefined)).map((d) => d.id)).toEqual(["c", "b", "a"]);
    expect(filterDocuments(docs, reportFilter("reports")).map((d) => d.id)).toEqual(["c", "a"]);
    expect(filterDocuments(docs, reportFilter("photos")).map((d) => d.id)).toEqual(["b"]);
    expect(filterDocuments(docs, reportFilter("all"), " blood ").map((d) => d.id)).toEqual(["a"]);
    expect(filterDocuments(docs, reportFilter("all"), "rash").map((d) => d.id)).toEqual(["b"]);
    expect(reportFilter("nope").id).toBe("all");
  });

  it("shows processing steps from the status", () => {
    expect(currentStep(doc("a", { status: "awaiting_upload" }), now)).toBe(0);
    expect(currentStep(doc("a", { status: "processing", createdAt: new Date(now - 2000).toISOString() }), now)).toBe(1);
    expect(currentStep(doc("a", { status: "processing", createdAt: new Date(now - 20000).toISOString() }), now)).toBe(2);
    expect(currentStep(doc("a"), now)).toBe(PROCESSING_STEPS.length);
  });

  it("compares with the printed range only, never 'normal'", () => {
    const findings = [finding("A", "within_range"), finding("B", "high"), finding("C", "within_range"), finding("D", "not_stated"), finding("E", "low")];
    const line = countsLine(findingCounts(findings));
    expect(line).toBe("2 within the report's range · 2 outside it · 1 with no range given");
    const labels = [line, ...(["within_range", "high", "low", "abnormal", "not_stated"] as const).map((f) => findingFlag(f)[1])].join(" ").toLowerCase();
    for (const word of ["normal", "healthy"]) expect(labels).not.toMatch(new RegExp(`\\b${word}\\b`));
    expect(orderedFindings(findings).map((f) => f.name)).toEqual(["B", "E", "A", "C", "D"]);
  });

  it("labels shared questions with where they came from", () => {
    const text = questionsText(doc("a"), ["What does it mean?", "Repeat test?"], true);
    expect(text).toContain("1. What does it mean?\n2. Repeat test?");
    expect(text).toContain("labs.pdf");
    expect(text).toContain("Sample questions");
    expect(questionsText(doc("a"), ["Q"], false)).toContain("Not a diagnosis");
  });

  it("formats file sizes", () => {
    expect([byteSize(500), byteSize(284_311), byteSize(1_204_551)]).toEqual(["500 B", "278 KB", "1.1 MB"]);
  });
});
