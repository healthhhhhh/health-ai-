import Foundation

/// Reports & photos list filters, the same on web (apps/web/src/lib/reports.ts).
public enum DocumentFilter: String, CaseIterable, Identifiable, Sendable {
    case all, reports, photos

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: "All"
        case .reports: "Reports"
        case .photos: "Photos"
        }
    }

    public var emptyTitle: String {
        switch self {
        case .all: "No reports yet"
        case .reports: "No reports yet"
        case .photos: "No photos yet"
        }
    }

    public var emptyMessage: String {
        switch self {
        case .all, .reports: "Upload a lab report to see each result explained in plain language, with questions to ask your doctor."
        case .photos: "Check a photo of a skin concern, cut or swelling to see what's visible and what to watch for."
        }
    }

    /// Documents this filter shows whose file name or title contains `query` (case-insensitive), newest first.
    public func apply(_ documents: [DocumentRecord], query: String = "") -> [DocumentRecord] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return documents
            .filter { self == .all || $0.kind == (self == .reports ? .report : .image) }
            .filter { needle.isEmpty || $0.filename.localizedCaseInsensitiveContains(needle) || DocumentPresentation.title($0).localizedCaseInsensitiveContains(needle) }
            .sorted { $0.createdAt > $1.createdAt }
    }
}

/// What the person sees while a file is being read, and a summary of the results.
public enum DocumentPresentation {
    public static let steps = ["Uploaded securely", "Reading the file", "Writing a plain-language summary"]

    /// Index of the step in progress (`steps.count` when finished). Reading turns into
    /// writing after a few seconds so a long wait still shows movement.
    public static func currentStep(_ document: DocumentRecord, now: Date = Date()) -> Int {
        switch document.status {
        case .awaitingUpload: 0
        case .processing: now.timeIntervalSince(document.createdAt) > 6 ? 2 : 1
        case .ready, .failed: steps.count
        }
    }

    public static func title(_ document: DocumentRecord) -> String {
        if document.kind == .image { return document.purpose?.label ?? "Photo" }
        return documentTypeLabel(document.result?.documentType) ?? document.filename
    }

    public static func documentTypeLabel(_ type: String?) -> String? {
        switch type {
        case "lab_results": "Lab results"
        case "imaging_report": "Imaging report"
        case "prescription": "Prescription"
        case "discharge_summary": "Discharge summary"
        case "clinic_letter": "Clinic letter"
        case "other": "Medical document"
        default: nil
        }
    }

    /// Compared with the range printed on the report — never "normal" or "abnormal".
    public static func flagLabel(_ flag: ReportFinding.Flag) -> String {
        switch flag {
        case .withinRange: "Within report range"
        case .high: "Above report range"
        case .low: "Below report range"
        case .abnormal: "Flagged on report"
        case .notStated: "No range given"
        }
    }

    public struct FindingCounts: Equatable, Sendable {
        public let within: Int
        public let outside: Int
        public let noRange: Int
    }

    public static func counts(_ findings: [ReportFinding]) -> FindingCounts {
        FindingCounts(
            within: findings.filter { $0.flag == .withinRange }.count,
            outside: findings.filter { [.high, .low, .abnormal].contains($0.flag) }.count,
            noRange: findings.filter { $0.flag == .notStated }.count
        )
    }

    /// Plain-language line for the counts, e.g. "4 within the report's range · 1 outside it".
    public static func countsLine(_ counts: FindingCounts) -> String {
        var parts: [String] = []
        if counts.within > 0 { parts.append("\(counts.within) within the report's range") }
        if counts.outside > 0 { parts.append("\(counts.outside) outside it") }
        if counts.noRange > 0 { parts.append("\(counts.noRange) with no range given") }
        return parts.joined(separator: " · ")
    }

    /// Findings outside the printed range first, keeping the report's order otherwise.
    public static func ordered(_ findings: [ReportFinding]) -> [ReportFinding] {
        let outside: Set<ReportFinding.Flag> = [.high, .low, .abnormal]
        return findings.filter { outside.contains($0.flag) } + findings.filter { !outside.contains($0.flag) }
    }

    /// The questions as text to copy or share, with where they came from.
    public static func questionsText(_ document: DocumentRecord, questions: [String], sample: Bool) -> String {
        var lines = ["Questions for my doctor about \(title(document)) (\(document.filename)):", ""]
        lines += questions.enumerated().map { "\($0.offset + 1). \($0.element)" }
        lines += ["", sample ? "Sample questions from HealthMate Preview mode — not about a real report." : "Suggested by the HealthMate AI Health Assistant. Not a diagnosis."]
        return lines.joined(separator: "\n")
    }

    /// A question for the AI Health Assistant about this document.
    public static func askPrompt(_ document: DocumentRecord) -> String {
        "Can you help me understand my \(title(document).lowercased()) (\(document.filename))?"
    }

    public static func byteSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        return String(format: "%.1f MB", Double(bytes) / 1024 / 1024)
    }
}
