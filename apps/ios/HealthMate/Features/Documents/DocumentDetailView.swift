import HealthMateCore
import SwiftUI

/// Result of a report or photo analysis (reference: fourth and fifth iOS screens).
/// Urgent guidance comes first; everything AI-written is labelled as such.
struct DocumentDetailView: View {
    let model: DocumentsViewModel
    let documentID: String
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            if let document = model.document(documentID) {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    content(document)
                }
                .padding(HM.Spacing.lg)
            } else {
                EmptyStateView(systemImage: "doc", title: "Not found", message: "This file was deleted.")
                    .padding(.top, 60)
            }
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle(model.document(documentID)?.kind == .image ? "Photo check" : "Report")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let document = model.document(documentID), document.status != .awaitingUpload {
                ToolbarItem(placement: .secondaryAction) {
                    Button {
                        Task { if let url = await model.originalFileURL(document.id) { openURL(url) } }
                    } label: {
                        Label("View original file", systemImage: "doc.viewfinder")
                    }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) { confirmDelete = true } label: { Image(systemName: "trash") }
                    .accessibilityLabel("Delete")
            }
        }
        .confirmationDialog("Delete this file and its summary?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if let document = model.document(documentID) { await model.delete(document) }
                    dismiss()
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ document: DocumentRecord) -> some View {
        switch document.status {
        case .awaitingUpload, .processing:
            VStack(spacing: 16) {
                MascotView(size: 110, withBackdrop: true)
                Text("Reading your \(document.kind == .report ? "report" : "photo")…")
                    .font(.hmSectionHeading)
                Text("This usually takes under a minute. You can leave this screen — we'll keep working.")
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                ProgressView()
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 40)
            .accessibilityElement(children: .combine)
        case .failed:
            EmptyStateView(systemImage: "exclamationmark.triangle", tone: .orange, title: "We couldn't analyse this file", message: document.failureReason ?? "Please try uploading it again.")
                .hmCard()
        case .ready:
            if let result = document.result {
                if result.injectionDetected {
                    Label("This file contained text that looked like instructions to the AI. It was ignored and only the medical content was read.", systemImage: "shield.lefthalf.filled")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
                }
                if result.type == .report {
                    ReportResultView(document: document, result: result)
                } else {
                    ImageResultView(document: document, result: result)
                }
                Text("AI-generated from your \(document.kind == .report ? "report" : "photo") on \(document.processedAt ?? document.createdAt, format: .dateTime.day().month().year()). Not a diagnosis.")
                    .font(.hmMicro)
                    .foregroundStyle(HM.Colors.textMuted)
            }
        }
    }
}

extension AnalysisResult {
    var documentTypeLabel: String? {
        switch documentType {
        case "lab_results": return "Lab results"
        case "imaging_report": return "Imaging report"
        case "prescription": return "Prescription"
        case "discharge_summary": return "Discharge summary"
        case "clinic_letter": return "Clinic letter"
        case "other": return "Medical document"
        default: return nil
        }
    }
}

// MARK: - Report

private struct ReportResultView: View {
    let document: DocumentRecord
    let result: AnalysisResult

    var body: some View {
        VStack(alignment: .leading, spacing: HM.Spacing.lg) {
            VStack(alignment: .leading, spacing: 6) {
                Text(result.documentTypeLabel ?? document.filename).font(.hmPageHeading)
                Text(document.filename).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            if result.readable == false {
                EmptyStateView(systemImage: "doc.questionmark", tone: .orange, title: "We couldn't read this report", message: "Try a clearer photo or the original PDF.")
                    .hmCard()
            } else {
                if let summary = result.summary {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Summary", systemImage: "sparkles").font(.hmCardTitle).foregroundStyle(HM.Colors.primary)
                        Text(summary).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                    }
                    .padding(HM.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(HMGradient.insight))
                }
                let findings = result.findings ?? []
                if !findings.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Results").font(.hmSectionHeading)
                        ForEach(findings) { FindingRow(finding: $0) }
                    }
                }
                if let questions = result.suggestedQuestions, !questions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Questions to ask your doctor", systemImage: "questionmark.bubble").font(.hmCardTitle)
                        ForEach(questions, id: \.self) { question in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(HM.Colors.primary)
                                Text(question).font(.hmBody)
                            }
                        }
                    }
                    .padding(HM.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hmCard()
                }
            }
        }
    }
}

private struct FindingRow: View {
    let finding: ReportFinding
    @State private var expanded = false

    /// Compared with the range printed on the report — never "normal"/"abnormal".
    private var flag: (StatusBadge.Status, String) {
        switch finding.flag {
        case .withinRange: return (.success, "Within report range")
        case .high: return (.warning, "Above report range")
        case .low: return (.warning, "Below report range")
        case .abnormal: return (.warning, "Flagged on report")
        case .notStated: return (.neutral, "No range given")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(finding.name).font(.hmBodyEmphasis)
                Spacer()
                Text([finding.value, finding.unit].compactMap { $0 }.joined(separator: " "))
                    .font(.hmBodyEmphasis.monospacedDigit())
            }
            HStack(spacing: 8) {
                StatusBadge(status: flag.0, text: flag.1)
                if let range = finding.referenceRange {
                    Text("Range \(range)").font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
                }
                Spacer()
                if let page = finding.page {
                    Text("Page \(page)").font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
                }
            }
            if expanded {
                Text(finding.explanation).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    .transition(.opacity)
            }
        }
        .padding(HM.Spacing.md)
        .hmCard()
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(HMMotion.spring) { expanded.toggle() } }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(expanded ? "Hides the explanation" : "Shows what this result means")
    }
}

// MARK: - Image

private struct ImageResultView: View {
    let document: DocumentRecord
    let result: AnalysisResult

    var body: some View {
        VStack(alignment: .leading, spacing: HM.Spacing.lg) {
            if let urgency = result.careUrgency, urgency == .urgent || urgency == .emergency {
                UrgentCareBanner(emergency: urgency == .emergency)
            }
            if result.quality == "poor" || result.supported == false {
                EmptyStateView(
                    systemImage: "camera.metering.unknown",
                    tone: .orange,
                    title: result.supported == false ? "We can't assess this kind of photo" : "The photo isn't clear enough",
                    message: result.qualityIssue ?? "Try again in good light, holding the camera steady and close."
                )
                .hmCard()
            } else {
                if let area = result.bodyArea {
                    Text(area).font(.hmPageHeading)
                }
                section("What we can see", systemImage: "eye", tone: .blue, items: result.observations ?? [])
                if let causes = result.possibleCauses, !causes.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Possible explanations", systemImage: "list.bullet.clipboard").font(.hmCardTitle)
                        Text("Not a diagnosis — only a clinician who examines you can say what this is.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                        ForEach(causes, id: \.name) { cause in
                            HStack {
                                Text(cause.name).font(.hmBody)
                                Spacer()
                                StatusBadge(status: .neutral, text: cause.likelihood == .possible ? "Possible" : "Less likely")
                            }
                        }
                    }
                    .padding(HM.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hmCard()
                }
                section("What you can do", systemImage: "checkmark.seal", tone: .green, items: result.recommendations ?? [])
            }
            if let signs = result.warningSigns, !signs.isEmpty {
                InfoPanel(title: "Get help quickly if you notice", systemImage: "exclamationmark.triangle", tone: .orange, items: signs)
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, systemImage: String, tone: Tone, items: [String]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label(title, systemImage: systemImage).font(.hmCardTitle).foregroundStyle(tone.color)
                ForEach(items, id: \.self) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(tone.color)
                        Text(item).font(.hmBody)
                    }
                }
            }
            .padding(HM.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .hmCard()
        }
    }
}

private struct UrgentCareBanner: View {
    let emergency: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(emergency ? "Get emergency help now" : "Please get this checked today", systemImage: "exclamationmark.triangle.fill")
                .font(.hmCardTitle)
                .foregroundStyle(emergency ? HM.Colors.error : HM.Colors.warning)
            Text(emergency
                ? "Based on what you described, call your local emergency number or go to the nearest emergency department."
                : "Contact a doctor or urgent-care service today. If it gets worse, call your local emergency number.")
                .font(.hmBody)
            if emergency {
                Button {
                    let number = SafetyEngine.emergencyNumber(regionCode: Locale.current.region?.identifier)
                    if let url = URL(string: "tel://\(number)") { openURL(url) }
                } label: {
                    Label("Call emergency services", systemImage: "phone.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.hmPrimary(fullWidth: true, compact: true))
            }
        }
        .padding(HM.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.lg).fill(emergency ? HM.Colors.errorSoft : HM.Colors.warningSoft))
        .accessibilityElement(children: .contain)
    }
}
