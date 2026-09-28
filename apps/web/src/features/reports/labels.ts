import type { AnalysisResult, DocumentRecord, ReportFinding } from "@healthmate/shared-types";
import type { Status } from "@/components/ui/status-badge";

export function documentTitle(doc: DocumentRecord): string {
  if (doc.kind === "image") return { skin: "Skin or rash", wound: "Cut or wound", swelling: "Swelling or bruise", other: "Photo" }[doc.purpose ?? "other"];
  return documentTypeLabel(doc.result) ?? doc.filename;
}

export function documentTypeLabel(result: AnalysisResult | null): string | undefined {
  switch (result?.documentType) {
    case "lab_results":
      return "Lab results";
    case "imaging_report":
      return "Imaging report";
    case "prescription":
      return "Prescription";
    case "discharge_summary":
      return "Discharge summary";
    case "clinic_letter":
      return "Clinic letter";
    case "other":
      return "Medical document";
    default:
      return undefined;
  }
}

/** Compared with the range printed on the report — never "normal" or "abnormal". */
export function findingFlag(flag: ReportFinding["flag"]): [Status, string] {
  switch (flag) {
    case "within_range":
      return ["success", "Within report range"];
    case "high":
      return ["warning", "Above report range"];
    case "low":
      return ["warning", "Below report range"];
    case "abnormal":
      return ["warning", "Flagged on report"];
    case "not_stated":
      return ["neutral", "No range given"];
  }
}

export function statusBadge(status: DocumentRecord["status"]): [Status, string] {
  switch (status) {
    case "ready":
      return ["success", "Ready"];
    case "failed":
      return ["error", "Failed"];
    default:
      return ["info", "Analysing"];
  }
}
