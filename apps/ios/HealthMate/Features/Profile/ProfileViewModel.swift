import Foundation
import HealthMateCore
import Observation

/// Health profile + health memory for the signed-in person.
@MainActor
@Observable
final class ProfileViewModel {
    enum LoadState: Equatable { case idle, loading, loaded, failed(String) }

    private(set) var state: LoadState = .idle
    private(set) var profile: HealthProfile?
    private(set) var memories: [MemoryRecord] = []
    var errorMessage: String?

    private let api: APIClient
    private let onSessionEnded: @MainActor (Error) -> Void

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void = { _ in }) {
        self.api = api
        self.onSessionEnded = onSessionEnded
    }

    func load() async {
        if profile == nil { state = .loading }
        do {
            async let profile = api.healthProfile()
            async let memories = api.memories()
            self.profile = try await profile
            self.memories = try await memories
            state = .loaded
        } catch {
            onSessionEnded(error)
            if profile == nil { state = .failed(Self.message(error)) } else { errorMessage = Self.message(error) }
        }
    }

    // MARK: Profile items — the person's own words are stored exactly as entered.

    func addCondition(_ name: String) async -> Bool {
        await mutate { try await self.api.addCondition(name: name, source: .userReported) }
    }

    func addAllergy(_ substance: String, reaction: String?) async -> Bool {
        await mutate { try await self.api.addAllergy(substance: substance, reaction: reaction, source: .userReported) }
    }

    /// `instruction` is saved verbatim — HealthMate never rewrites dosing.
    func addMedication(_ name: String, instruction: String, fromClinician: Bool) async -> Bool {
        await mutate { try await self.api.addMedication(name: name, instruction: instruction, source: fromClinician ? .clinicianProvided : .userReported) }
    }

    func remove(_ collection: String, id: String) async {
        _ = await mutate { try await self.api.removeProfileItem(collection, id: id) }
    }

    // MARK: Memory

    func addMemory(_ fact: String) async -> Bool {
        await mutate { _ = try await self.api.saveMemory(fact) }
    }

    /// Editing a fact makes it confirmed by the person.
    func updateMemory(_ memory: MemoryRecord, fact: String) async -> Bool {
        await mutate { _ = try await self.api.updateMemory(memory.id, fact: fact) }
    }

    func deleteMemory(_ memory: MemoryRecord) async {
        _ = await mutate { try await self.api.deleteMemory(memory.id) }
    }

    func searchMemories(_ query: String) async -> [MemoryRecord] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return memories }
        return (try? await api.memories(query: trimmed)) ?? []
    }

    // MARK: Data controls

    /// Writes the export to a temporary file for the share sheet.
    func exportFile() async -> URL? {
        do {
            let data = try await api.exportData()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("HealthMate-export.json")
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            return url
        } catch {
            onSessionEnded(error)
            errorMessage = Self.message(error)
            return nil
        }
    }

    func reset() {
        profile = nil
        memories = []
        state = .idle
        errorMessage = nil
    }

    private func mutate(_ work: @escaping () async throws -> Void) async -> Bool {
        errorMessage = nil
        do {
            try await work()
            await load()
            return true
        } catch {
            onSessionEnded(error)
            errorMessage = Self.message(error)
            return false
        }
    }

    private static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
    }
}
