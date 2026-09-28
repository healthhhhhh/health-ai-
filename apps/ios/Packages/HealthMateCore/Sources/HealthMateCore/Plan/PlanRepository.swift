import Foundation

/// Persistence for the plan. Local-only for now; a sync-capable implementation
/// can replace it without touching the UI.
public protocol PlanRepository: Sendable {
    func load() async throws -> PlanDocument
    func save(_ document: PlanDocument) async throws
}

public enum PlanRepositoryError: Error, Equatable {
    case unreadable
    case unwritable
}

/// Stores the plan as JSON in Application Support, protected with iOS data protection.
public actor FilePlanRepository: PlanRepository {
    private let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public static func defaultFileURL(fileManager: FileManager = .default) throws -> URL {
        let base = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return base.appendingPathComponent("HealthMate", isDirectory: true).appendingPathComponent("plan.json")
    }

    public func load() async throws -> PlanDocument {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return PlanDocument() }
        do {
            let data = try Data(contentsOf: fileURL)
            return try Self.decoder().decode(PlanDocument.self, from: data)
        } catch {
            throw PlanRepositoryError.unreadable
        }
    }

    public func save(_ document: PlanDocument) async throws {
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try Self.encoder().encode(document)
            #if os(iOS)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            #else
            try data.write(to: fileURL, options: [.atomic])
            #endif
        } catch {
            throw PlanRepositoryError.unwritable
        }
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

/// In-memory repository for tests and previews. Can simulate write failures.
public actor InMemoryPlanRepository: PlanRepository {
    private var document: PlanDocument
    private var failSaves = false

    public init(document: PlanDocument = PlanDocument()) {
        self.document = document
    }

    public func setFailSaves(_ fail: Bool) { failSaves = fail }
    public func stored() -> PlanDocument { document }

    public func load() async throws -> PlanDocument { document }

    public func save(_ document: PlanDocument) async throws {
        if failSaves { throw PlanRepositoryError.unwritable }
        self.document = document
    }
}
