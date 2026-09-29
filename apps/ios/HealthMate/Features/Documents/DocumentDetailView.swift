import HealthMateCore
import SwiftUI

/// Result of a report or photo analysis (reference: fourth and fifth iOS screens).
/// Urgent guidance comes first; everything AI-written is labelled as such.
struct DocumentDetailView: View {
    let model: DocumentsViewModel
    let documentID: String
    @State private var confirmDelete = false
    @State private var showOriginal = false
    @State private var photoCheck: PhotoCheckRequest?
    @State private var newResultID: String?
    @State private var showCareFinder = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.askAssistant) private var askAssistant

    /// Opens the photo check again, e.g. to retake a photo that wasn't clear.
    struct PhotoCheckRequest: Identifiable {
        let id = UUID()
        let purpose: ImagePurpose?
        let retake: Bool
    }

    var body: some View {
        ScrollView {
            if let document = model.document(documentID) {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    header(document)
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
                    Button { showOriginal = true } label: {
                        Label("View original file", systemImage: "doc.viewfinder")
                    }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) { confirmDelete = true } label: { Image(systemName: "trash") }
                    .accessibilityLabel("Delete")
            }
        }
        .navigationDestination(isPresented: $showOriginal) {
            if let document = model.document(documentID) { OriginalFileView(model: model, document: document) }
        }
        .sheet(item: $photoCheck) { request in
            PhotoCheckView(model: model, initialPurpose: request.purpose, retake: request.retake) { record in newResultID = record.id }
        }
        .sheet(isPresented: $showCareFinder) { CareFinderView() }
        .navigationDestination(item: $newResultID) { id in DocumentDetailView(model: model, documentID: id) }
        .confirmationDialog("Delete this file and its summary?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if let document = model.document(documentID) { await model.delete(document) }
                    dismiss()
                }
            }
        }
    }

    private func header(_ document: DocumentRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(document.kind == .image ? (document.result?.bodyArea ?? DocumentPresentation.title(document)) : DocumentPresentation.title(document))
                .font(.hmPageHeading)
            Text("\(document.filename) · \(DocumentPresentation.byteSize(document.byteSize)) · uploaded \(document.createdAt.formatted(.dateTime.day().month().year()))")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func content(_ document: DocumentRecord) -> some View {
        let unreadable = document.status == .ready && document.result?.type == .report && document.result?.readable == false
        switch document.status {
        case .awaitingUpload, .processing:
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: HM.Spacing.md) {
                    Text("Reading your \(document.kind == .report ? "report" : "photo")…").font(.hmSectionHeading)
                    Text("This usually takes under a minute. You can leave this screen — we'll send a notification when it's ready.")
                        .font(.hmBody)
                        .foregroundStyle(HM.Colors.textSecondary)
                    StepProgressView(steps: DocumentPresentation.steps.map { .init(label: $0) }, current: DocumentPresentation.currentStep(document, now: context.date))
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()
            }
        case .failed:
            couldNotRead(document, title: "We couldn't analyse this file", message: document.failureReason ?? "Please try uploading it again.")
        case .ready where unreadable:
            couldNotRead(document, title: "We couldn't read this report", message: document.result?.summary ?? "Try a clearer photo or the original PDF.")
        case .ready:
            if let result = document.result {
                let sample = result.model == "sample"
                // Urgent guidance always comes first.
                if result.type == .image, let urgency = result.careUrgency, urgency == .urgent || urgency == .emergency {
                    UrgentCareBanner(emergency: urgency == .emergency, onFindCare: { showCareFinder = true })
                }
                if sample {
                    SampleContentLabel(text: "Sample result in Preview mode — this file wasn't analysed and nothing here is about you.")
                }
                if result.injectionDetected {
                    Label("This file contained text that looked like instructions to the AI. It was ignored and only the medical content was read.", systemImage: "shield.lefthalf.filled")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
                }
                if result.type == .report {
                    ReportResultView(document: document, result: result, sample: sample)
                } else {
                    ImageResultView(document: document, result: result, onRetake: { photoCheck = .init(purpose: document.purpose, retake: true) }, onFindCare: { showCareFinder = true })
                    nextSteps(document)
                }
                let read = (document.processedAt ?? document.createdAt).formatted(.dateTime.day().month().year())
                if sample {
                    Text("Sample content for Preview mode · \(read). Not a diagnosis.").font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
                } else {
                    AIGeneratedLabel(basedOn: "\(document.filename), read \(read)")
                }
            }
        }
    }

    private func nextSteps(_ document: DocumentRecord) -> some View {
        VStack(spacing: 8) {
            Button { photoCheck = .init(purpose: document.purpose, retake: false) } label: {
                Label("Check another photo", systemImage: "camera").frame(maxWidth: .infinity)
            }
            .buttonStyle(.hmSecondary)
            if let askAssistant {
                Button { askAssistant(DocumentPresentation.askPrompt(document)) } label: {
                    Label("Ask the AI Health Assistant", systemImage: "bubble.left.and.text.bubble.right").frame(maxWidth: .infinity)
                }
                .buttonStyle(.hmSecondary)
            }
            Button { showCareFinder = true } label: {
                Label("Find care", systemImage: "stethoscope").frame(maxWidth: .infinity)
            }
            .buttonStyle(.hmSecondary)
        }
    }

    private func couldNotRead(_ document: DocumentRecord, title: String, message: String) -> some View {
        VStack(spacing: HM.Spacing.md) {
            EmptyStateView(systemImage: "doc.questionmark", tone: .orange, title: title, message: message) {
                VStack(spacing: 8) {
                    Button("Upload again") {
                        if document.kind == .image { photoCheck = .init(purpose: document.purpose, retake: true) } else { dismiss() }
                    }
                    .buttonStyle(.hmPrimary)
                    Button("Check the original") { showOriginal = true }.buttonStyle(.hmSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(["Upload the original PDF if you have it.", "For a photo, lay the page flat in good light and include the whole page.", "Password-protected files can't be read — save an unprotected copy first."], id: \.self) { tip in
                    Label(tip, systemImage: "lightbulb").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                }
            }
        }
        .padding(HM.Spacing.md)
        .hmCard()
    }
}

// MARK: - Report

private struct ReportResultView: View {
    let document: DocumentRecord
    let result: AnalysisResult
    let sample: Bool
    @Environment(\.askAssistant) private var askAssistant
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: HM.Spacing.lg) {
            if let summary = result.summary {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Summary", systemImage: "sparkles").font(.hmCardTitle).foregroundStyle(HM.Colors.primary)
                    Text(summary).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(HMGradient.insight))
            }
            let findings = DocumentPresentation.ordered(result.findings ?? [])
            if !findings.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Results").font(.hmSectionHeading)
                        Text("\(findings.count) results · \(DocumentPresentation.countsLine(DocumentPresentation.counts(findings))). Compared only with the range printed on this report — tap a result for its explanation.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                    ForEach(findings) { FindingRow(finding: $0) }
                }
            }
            if let questions = result.suggestedQuestions, !questions.isEmpty {
                let text = DocumentPresentation.questionsText(document, questions: questions, sample: sample)
                VStack(alignment: .leading, spacing: 10) {
                    Label("Questions to ask your doctor", systemImage: "questionmark.bubble").font(.hmCardTitle)
                    ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(index + 1).").font(.hmBodyEmphasis).foregroundStyle(HM.Colors.primary)
                            Text(question).font(.hmBody)
                        }
                    }
                    HStack(spacing: 8) {
                        Button {
                            UIPasteboard.general.string = text
                            copied = true
                        } label: {
                            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.hmSecondary)
                        ShareLink(item: text, subject: Text("Questions for my doctor")) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.hmSecondary)
                    }
                    if let askAssistant {
                        Button {
                            askAssistant(DocumentPresentation.askPrompt(document))
                        } label: {
                            Label("Ask the AI Health Assistant", systemImage: "bubble.left.and.text.bubble.right")
                        }
                        .buttonStyle(.hmSecondary)
                    }
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()
                .sensoryFeedback(.success, trigger: copied)
            }
        }
    }
}

private struct FindingRow: View {
    let finding: ReportFinding
    @State private var expanded = false

    /// Compared with the range printed on the report — never "normal"/"abnormal".
    private var status: StatusBadge.Status {
        switch finding.flag {
        case .withinRange: .success
        case .high, .low, .abnormal: .warning
        case .notStated: .neutral
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
                StatusBadge(status: status, text: DocumentPresentation.flagLabel(finding.flag))
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
    var onRetake: () -> Void
    var onFindCare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HM.Spacing.lg) {
            if result.quality == "poor" || result.supported == false {
                VStack(alignment: .leading, spacing: HM.Spacing.md) {
                    EmptyStateView(
                        systemImage: "camera.metering.unknown",
                        tone: .orange,
                        title: result.supported == false ? "We can't assess this kind of photo" : "The photo isn't clear enough",
                        message: result.qualityIssue ?? "Try again in good light, holding the camera steady and close."
                    ) {
                        if result.supported == false {
                            Button("Find care", action: onFindCare).buttonStyle(.hmPrimary)
                        } else {
                            Button("Retake photo", action: onRetake).buttonStyle(.hmPrimary)
                        }
                    }
                    if result.supported != false {
                        ForEach(PhotoCheck.captureTips, id: \.self) { tip in
                            Label(tip, systemImage: "lightbulb").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                    }
                }
                .padding(HM.Spacing.md)
                .hmCard()
            } else {
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
    var onFindCare: () -> Void = {}
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
            Button(action: onFindCare) {
                Label(emergency ? "Find the nearest emergency department" : "Find urgent care", systemImage: "mappin.and.ellipse").frame(maxWidth: .infinity)
            }
            .buttonStyle(.hmSecondary)
        }
        .padding(HM.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.lg).fill(emergency ? HM.Colors.errorSoft : HM.Colors.warningSoft))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(emergency ? "Emergency guidance" : "Urgent guidance")
    }
}
