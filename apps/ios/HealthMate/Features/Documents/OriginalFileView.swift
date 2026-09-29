import HealthMateCore
import PDFKit
import SwiftUI

/// The uploaded file itself, fetched through a short-lived signed link and shown in the app.
struct OriginalFileView: View {
    let model: DocumentsViewModel
    let document: DocumentRecord

    private enum Phase { case loading, pdf(PDFDocument), image(UIImage), failed(offline: Bool, message: String) }
    @State private var phase: Phase = .loading
    @State private var attempt = 0

    var body: some View {
        VStack(spacing: 0) {
            if model.isPreview {
                SampleContentLabel(text: "Preview mode doesn't keep uploaded files, so this shows an example file — not your upload.")
                    .padding(HM.Spacing.md)
            }
            Group {
                switch phase {
                case .loading:
                    StateView(state: .loading)
                case .pdf(let pdf):
                    PDFKitView(document: pdf)
                        .accessibilityLabel("Original file: \(document.filename)")
                case .image(let image):
                    ScrollView([.horizontal, .vertical]) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .accessibilityLabel("Original file: \(document.filename)")
                    }
                case .failed(let offline, let message):
                    EmptyStateView(systemImage: offline ? "wifi.slash" : "exclamationmark.triangle", tone: .orange, title: offline ? "You're offline" : "The file couldn't load", message: message) {
                        Button("Try again") { attempt += 1 }.buttonStyle(.hmPrimary)
                    }
                    .padding(HM.Spacing.lg)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Text("The link to this file expires after a few minutes and only works for your account.")
                .font(.hmMicro)
                .foregroundStyle(HM.Colors.textMuted)
                .padding(HM.Spacing.sm)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Original file")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: attempt) { await load() }
    }

    private func load() async {
        phase = .loading
        do {
            let file = try await model.originalFile(document.id)
            if let pdf = PDFDocument(data: file.data) {
                phase = .pdf(pdf)
            } else if let image = UIImage(data: file.data) {
                phase = .image(image)
            } else {
                phase = .failed(offline: false, message: "This file can't be shown in the app.")
            }
        } catch {
            phase = .failed(offline: (error as? APIError) == .network, message: (error as? LocalizedError)?.errorDescription ?? "Please try again.")
        }
    }
}

private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
