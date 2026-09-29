import HealthMateCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Reports & photos: upload a lab report (PDF or photo) or a photo of a skin
/// concern and get a plain-language, AI-generated summary.
struct DocumentsView: View {
    let session: SessionStore

    @State private var model: DocumentsViewModel
    @State private var showFileImporter = false
    @State private var reportPhoto: PhotosPickerItem?
    @State private var showPhotoCheck = false
    @State private var showReportCamera = false
    @State private var openedID: String?

    /// Opens the photo check straight away (from Chat's "Check a photo").
    private let startWithPhotoCheck: Bool

    init(session: SessionStore, startWithPhotoCheck: Bool = false) {
        self.session = session
        self.startWithPhotoCheck = startWithPhotoCheck
        _model = State(initialValue: DocumentsViewModel(api: session.api, isPreview: session.isPreview, onSessionEnded: { [session] in session.handle($0) }))
    }

    private var hasConsent: Bool { session.hasConsent("document_processing") }

    var body: some View {
        List {
            if !session.isSignedIn {
                Section { Text("Sign in to analyse reports and photos.").font(.hmBody) }
            } else if !hasConsent {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Before you upload", systemImage: "lock.shield").font(.hmCardTitle)
                        Text("Files you upload are stored in your account and sent to our AI provider to create a summary. You can delete any file at any time. Summaries are general information, not a diagnosis.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                        Button("Allow and continue") { Task { await session.setConsent("document_processing", granted: true) } }
                            .buttonStyle(.hmPrimary(fullWidth: true))
                    }
                    .padding(.vertical, 6)
                }
            } else {
                Section {
                    HStack(spacing: 12) {
                        uploadTile(title: "Upload report", subtitle: "PDF or file", systemImage: "doc.badge.plus", tone: .blue) { showFileImporter = true }
                        PhotosPicker(selection: $reportPhoto, matching: .images) {
                            tileLabel(title: "Report photo", subtitle: "From Photos", systemImage: "doc.viewfinder", tone: .teal)
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.96))
                    }
                    if CameraPicker.isAvailable {
                        uploadTile(title: "Photograph a report", subtitle: "Use the camera", systemImage: "camera", tone: .blue) { showReportCamera = true }
                    }
                    uploadTile(title: "Check a photo", subtitle: "Skin, wound or swelling", systemImage: "camera.viewfinder", tone: .purple, wide: true) { showPhotoCheck = true }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))

                if session.isPreview {
                    Section {
                        Text("Preview tip: files aren't analysed. Put “blurry” in a file name to see the unreadable result, or “damaged” to see a failed upload.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                }

                switch model.state {
                case .idle, .loading:
                    Section { StateView(state: .loading).frame(maxWidth: .infinity) }
                case .failed(let message):
                    Section {
                        EmptyStateView(systemImage: model.isOffline ? "wifi.slash" : "exclamationmark.triangle", tone: .orange, title: model.isOffline ? "You're offline" : "Your reports couldn't load", message: message) {
                            Button("Try again") { Task { await model.load() } }.buttonStyle(.hmPrimary)
                        }
                    }
                    .listRowBackground(Color.clear)
                case .loaded:
                    if !model.documents.isEmpty {
                        Section {
                            FilterChips(options: DocumentFilter.allCases.map { .init(value: $0, label: $0.label) }, selection: $model.filter)
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    }
                    let shown = model.shown
                    if shown.isEmpty {
                        Section {
                            if !model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                                EmptyStateView(systemImage: "magnifyingglass", title: "Nothing matches “\(model.query)”", message: "Try another word, or clear the search.")
                            } else {
                                EmptyStateView(systemImage: model.filter == .photos ? "photo" : "doc.text.magnifyingglass", title: model.filter.emptyTitle, message: model.filter.emptyMessage) {
                                    if model.filter != .all && !model.documents.isEmpty {
                                        Button("Show everything") { model.filter = .all }.buttonStyle(.hmSecondary)
                                    }
                                }
                            }
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        Section("Your reports and photos") { rows(shown) }
                    }
                }
            }
        }
        .navigationTitle("Reports & photos")
        .searchable(text: $model.query, prompt: "Search by name")
        .refreshable { await model.load() }
        .task(id: hasConsent) {
            guard session.isSignedIn && hasConsent else { return }
            let openPhotoCheck = startWithPhotoCheck && model.state == .idle
            await model.load()
            if openPhotoCheck {
                // A sheet can't be presented while this screen's own sheet is still animating in.
                try? await Task.sleep(for: .milliseconds(700))
                showPhotoCheck = true
            }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.pdf, .jpeg, .png, .heic]) { result in
            guard case .success(let url) = result else { return }
            importFile(url)
        }
        .onChange(of: reportPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    model.pending = .init(kind: .report, data: data, filename: "Report photo.jpg")
                } else {
                    model.errorMessage = "We couldn't open that photo. Please try another one."
                }
                reportPhoto = nil
            }
        }
        .fullScreenCover(isPresented: $showReportCamera) {
            CameraPicker { data in model.pending = .init(kind: .report, data: data, filename: "Report photo.jpg") }
                .ignoresSafeArea()
        }
        .sheet(isPresented: $showPhotoCheck) {
            PhotoCheckView(model: model) { record in openedID = record.id }
        }
        .sheet(item: $model.pending) { pending in
            UploadConfirmView(model: model, pending: pending) { record in openedID = record.id }
                .presentationDetents([.medium, .large])
        }
        .navigationDestination(item: $openedID) { id in
            DocumentDetailView(model: model, documentID: id)
        }
        .alert("Upload problem", isPresented: Binding(get: { model.errorMessage != nil && !showPhotoCheck && model.pending == nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private func rows(_ documents: [DocumentRecord]) -> some View {
        ForEach(documents) { document in
            Button { openedID = document.id } label: { DocumentRow(document: document) }
        }
        .onDelete { offsets in
            let targets = offsets.map { documents[$0] }
            Task { for document in targets { await model.delete(document) } }
        }
    }

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            model.errorMessage = "We couldn't open that file."
            return
        }
        model.pending = .init(kind: .report, data: data, filename: url.lastPathComponent)
    }

    private func uploadTile(title: String, subtitle: String, systemImage: String, tone: Tone, wide: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { tileLabel(title: title, subtitle: subtitle, systemImage: systemImage, tone: tone) }
            .buttonStyle(PressableButtonStyle(scale: 0.96))
            .disabled(model.uploading)
    }

    private func tileLabel(title: String, subtitle: String, systemImage: String, tone: Tone) -> some View {
        HStack(spacing: 10) {
            IconBadge(systemName: systemImage, tone: tone, size: .small, filled: true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text(subtitle).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
    }
}

private struct DocumentRow: View {
    let document: DocumentRecord

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: document.kind == .report ? "doc.text" : "photo", tone: document.kind == .report ? .blue : .purple)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary).lineLimit(1)
                Text("\(document.filename) · \(DocumentPresentation.byteSize(document.byteSize)) · \(document.createdAt.formatted(.dateTime.day().month().year()))")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            switch document.status {
            case .processing, .awaitingUpload:
                StatusBadge(status: .info, text: "Analysing")
            case .ready:
                StatusBadge(status: .success, text: "Ready")
            case .failed:
                StatusBadge(status: .error, text: "Couldn't read")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var title: String { DocumentPresentation.title(document) }
}

/// Shows the chosen file before it's uploaded, then the upload's progress.
private struct UploadConfirmView: View {
    let model: DocumentsViewModel
    let pending: DocumentsViewModel.PendingUpload
    var onUploaded: (DocumentRecord) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    HStack(spacing: 12) {
                        if !pending.isPDF, let image = UIImage(data: pending.data) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: HM.Radius.md))
                                .accessibilityHidden(true)
                        } else {
                            IconBadge(systemName: "doc.text", tone: .blue)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(pending.filename).font(.hmBodyEmphasis).lineLimit(2)
                            Text("\(DocumentPresentation.byteSize(pending.data.count)) · Medical report")
                                .font(.hmCaption)
                                .foregroundStyle(HM.Colors.textSecondary)
                        }
                    }
                    .accessibilityElement(children: .combine)

                    if model.uploading {
                        StepProgressView(steps: DocumentPresentation.steps.enumerated().map { .init(label: $0.offset == 0 ? "Uploading securely" : $0.element) }, current: 0)
                    } else {
                        if let error = model.errorMessage {
                            Label(error, systemImage: "exclamationmark.circle.fill")
                                .font(.hmCaption)
                                .foregroundStyle(HM.Colors.error)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.errorSoft))
                        }
                        Button(model.errorMessage == nil ? "Upload and summarise" : "Try again") {
                            Task {
                                if let record = await model.confirmPending() {
                                    dismiss()
                                    onUploaded(record)
                                }
                            }
                        }
                        .buttonStyle(.hmPrimary(fullWidth: true))
                        .accessibilityIdentifier("confirmUpload")
                    }
                    Text("Each result is explained in plain language, compared with the range printed on the report, with questions to ask your doctor. Photos are re-saved without location data before upload.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                .padding(HM.Spacing.lg)
            }
            .navigationTitle("Upload this file?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.pending = nil }.disabled(model.uploading)
                }
            }
            .interactiveDismissDisabled(model.uploading)
            .onAppear { model.errorMessage = nil }
        }
    }
}
