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

    init(session: SessionStore) {
        self.session = session
        _model = State(initialValue: DocumentsViewModel(api: session.api, onSessionEnded: { [session] in session.handle($0) }))
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
                    if model.uploading {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Uploading securely…").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))

                switch model.state {
                case .idle, .loading:
                    Section { ProgressView().frame(maxWidth: .infinity) }
                case .failed(let message):
                    Section {
                        Label(message, systemImage: "wifi.exclamationmark").font(.hmCaption)
                        Button("Try again") { Task { await model.load() } }
                    }
                case .loaded:
                    if model.documents.isEmpty {
                        Section {
                            EmptyStateView(systemImage: "doc.text.magnifyingglass", title: "No reports yet", message: "Upload a lab report to see each result explained in plain language, with questions to ask your doctor.")
                        }
                    }
                    if !model.reports.isEmpty {
                        Section("Reports") { rows(model.reports) }
                    }
                    if !model.images.isEmpty {
                        Section("Photos") { rows(model.images) }
                    }
                }
            }
        }
        .navigationTitle("Reports & photos")
        .refreshable { await model.load() }
        .task(id: hasConsent) { if session.isSignedIn && hasConsent { await model.load() } }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.pdf, .jpeg, .png, .heic]) { result in
            guard case .success(let url) = result else { return }
            Task { await importFile(url) }
        }
        .onChange(of: reportPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let record = await model.submitReport(data: data, filename: "report.jpg") {
                    openedID = record.id
                }
                reportPhoto = nil
            }
        }
        .fullScreenCover(isPresented: $showReportCamera) {
            CameraPicker { data in
                Task {
                    if let record = await model.submitReport(data: data, filename: "report.jpg") { openedID = record.id }
                }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showPhotoCheck) {
            PhotoCheckView(model: model) { record in openedID = record.id }
        }
        .navigationDestination(item: $openedID) { id in
            DocumentDetailView(model: model, documentID: id)
        }
        .alert("Upload problem", isPresented: Binding(get: { model.errorMessage != nil && !showPhotoCheck }, set: { if !$0 { model.errorMessage = nil } })) {
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

    private func importFile(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            model.errorMessage = "We couldn't open that file."
            return
        }
        if let record = await model.submitReport(data: data, filename: url.lastPathComponent) { openedID = record.id }
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
                Text(document.createdAt, format: .dateTime.day().month().year())
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer()
            switch document.status {
            case .processing, .awaitingUpload:
                StatusBadge(status: .info, text: "Analysing")
            case .ready:
                StatusBadge(status: .success, text: "Ready")
            case .failed:
                StatusBadge(status: .error, text: "Failed")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        if document.kind == .image { return document.purpose?.label ?? "Photo" }
        return document.result?.documentTypeLabel ?? document.filename
    }
}

/// Pick a photo, say what it shows, optionally add a note.
private struct PhotoCheckView: View {
    let model: DocumentsViewModel
    var onSubmitted: (DocumentRecord) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var item: PhotosPickerItem?
    @State private var showCamera = false
    @State private var imageData: Data?
    @State private var purpose: ImagePurpose = .skin
    @State private var note = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PhotosPicker(selection: $item, matching: .images) {
                        if let imageData, let image = UIImage(data: imageData) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(height: 200)
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: HM.Radius.md))
                                .accessibilityLabel("Selected photo. Tap to choose another.")
                        } else {
                            Label("Choose a photo", systemImage: "photo.on.rectangle")
                        }
                    }
                    if CameraPicker.isAvailable {
                        Button { showCamera = true } label: {
                            Label(imageData == nil ? "Take a photo" : "Retake with camera", systemImage: "camera")
                        }
                    }
                } footer: {
                    Text("Use good light and hold the camera close. Location data is removed before upload.")
                }
                Section("What does it show?") {
                    Picker("Area", selection: $purpose) {
                        ForEach(ImagePurpose.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.menu)
                    TextField("Anything else? e.g. itchy for 3 days", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error = model.errorMessage {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error) }
                }
                Section {
                    DisclaimerView(text: "Photo checks describe what's visible and suggest next steps. They can't diagnose — a clinician needs to examine you for that.")
                }
            }
            .navigationTitle("Check a photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if model.uploading {
                        ProgressView()
                    } else {
                        Button("Analyse") {
                            guard let imageData else { return }
                            Task {
                                let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                                if let record = await model.submitPhoto(data: imageData, purpose: purpose, note: trimmed.isEmpty ? nil : trimmed) {
                                    dismiss()
                                    onSubmitted(record)
                                }
                            }
                        }
                        .disabled(imageData == nil)
                    }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { data in imageData = data }
                    .ignoresSafeArea()
            }
            .onChange(of: item) { _, item in
                Task { imageData = try? await item?.loadTransferable(type: Data.self) }
            }
            .onAppear { model.errorMessage = nil }
        }
    }
}
