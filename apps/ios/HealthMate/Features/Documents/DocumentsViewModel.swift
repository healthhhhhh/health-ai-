import Foundation
import HealthMateCore
import Observation
import UIKit

/// Upload + analysis of medical reports and photos. Files are treated as
/// untrusted: the server sniffs their type and the AI is told to ignore any
/// instructions inside them.
@MainActor
@Observable
final class DocumentsViewModel {
    enum LoadState: Equatable { case idle, loading, loaded, failed(String) }

    private(set) var state: LoadState = .idle
    private(set) var documents: [DocumentRecord] = []
    private(set) var uploading = false
    var errorMessage: String?

    private let api: APIClient
    private let onSessionEnded: @MainActor (Error) -> Void
    private var pollTask: Task<Void, Never>?

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void = { _ in }) {
        self.api = api
        self.onSessionEnded = onSessionEnded
    }

    var reports: [DocumentRecord] { documents.filter { $0.kind == .report } }
    var images: [DocumentRecord] { documents.filter { $0.kind == .image } }

    func load() async {
        if documents.isEmpty { state = .loading }
        do {
            documents = try await api.documents()
            state = .loaded
            pollIfNeeded()
        } catch {
            onSessionEnded(error)
            if documents.isEmpty { state = .failed(Self.message(error)) } else { errorMessage = Self.message(error) }
        }
    }

    /// Uploads a PDF or image of a report.
    func submitReport(data: Data, filename: String) async -> DocumentRecord? {
        if data.starts(with: Array("%PDF-".utf8)) {
            return await submit(kind: .report, data: data, filename: filename, contentType: "application/pdf", purpose: nil, note: nil)
        }
        guard let jpeg = ImagePreparation.jpeg(from: data) else {
            errorMessage = "That file type isn't supported. Choose a PDF or a photo."
            return nil
        }
        return await submit(kind: .report, data: jpeg, filename: Self.jpegName(filename), contentType: "image/jpeg", purpose: nil, note: nil)
    }

    func submitPhoto(data: Data, purpose: ImagePurpose, note: String?) async -> DocumentRecord? {
        guard let jpeg = ImagePreparation.jpeg(from: data) else {
            errorMessage = "We couldn't read that photo. Please try another one."
            return nil
        }
        return await submit(kind: .image, data: jpeg, filename: "photo.jpg", contentType: "image/jpeg", purpose: purpose, note: note)
    }

    func delete(_ document: DocumentRecord) async {
        do {
            try await api.deleteDocument(document.id)
            documents.removeAll { $0.id == document.id }
        } catch {
            onSessionEnded(error)
            errorMessage = Self.message(error)
        }
    }

    func document(_ id: String) -> DocumentRecord? { documents.first { $0.id == id } }

    private func submit(kind: DocumentKind, data: Data, filename: String, contentType: String, purpose: ImagePurpose?, note: String?) async -> DocumentRecord? {
        guard data.count <= 20 * 1024 * 1024 else {
            errorMessage = "That file is larger than 20 MB. Please choose a smaller one."
            return nil
        }
        uploading = true
        errorMessage = nil
        defer { uploading = false }
        do {
            let record = try await api.submitDocument(kind: kind, data: data, filename: filename, contentType: contentType, purpose: purpose, note: note)
            documents.insert(record, at: 0)
            pollIfNeeded()
            return record
        } catch {
            onSessionEnded(error)
            errorMessage = Self.message(error)
            return nil
        }
    }

    /// Refreshes documents that are still being analysed.
    private func pollIfNeeded() {
        guard pollTask == nil, documents.contains(where: { $0.status == .processing }) else { return }
        pollTask = Task { [weak self] in
            var delay = 2.0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(delay))
                guard let self else { return }
                let pending = self.documents.filter { $0.status == .processing }
                if pending.isEmpty { break }
                for doc in pending {
                    if let fresh = try? await self.api.document(doc.id), let index = self.documents.firstIndex(where: { $0.id == doc.id }) {
                        self.documents[index] = fresh
                    }
                }
                delay = min(delay * 1.5, 10)
            }
            self?.pollTask = nil
        }
    }

    private static func jpegName(_ filename: String) -> String {
        let base = (filename as NSString).deletingPathExtension
        return (base.isEmpty ? "report" : base) + ".jpg"
    }

    private static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
    }
}

enum ImagePreparation {
    /// Re-encodes any image as JPEG, at most 2048 px on the long side. This also
    /// drops embedded metadata such as GPS location before upload.
    static func jpeg(from data: Data, maxDimension: CGFloat = 2048) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxDimension ? maxDimension / longest : 1
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
}
