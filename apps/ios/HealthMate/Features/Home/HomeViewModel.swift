import Foundation
import HealthMateCore
import Observation

/// Home screen state. All business rules live here or in HealthMateCore —
/// views only render and forward intents.
@MainActor
@Observable
final class HomeViewModel {
    enum LoadState: Equatable {
        case idle, loading, loaded, failed(String)
    }

    private(set) var state: LoadState = .idle
    private(set) var summary: HomeSummary?
    private(set) var mood: Mood?
    /// Transient, user-facing error for a failed action (shown as a toast).
    var actionError: String?

    private let service: any HealthDataService

    init(service: any HealthDataService) {
        self.service = service
    }

    var isSampleData: Bool { service.isSampleData }

    func loadIfNeeded() async {
        guard state == .idle else { return }
        await load()
    }

    func load() async {
        if summary == nil { state = .loading }
        do {
            let result = try await service.homeSummary()
            summary = result
            mood = result.todayMood?.mood
            state = .loaded
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? "We couldn't load your dashboard."
            if summary == nil {
                state = .failed(message)
            } else {
                actionError = message
            }
        }
    }

    func selectMood(_ newMood: Mood) async {
        let previous = mood
        mood = newMood
        do {
            _ = try await service.recordMood(newMood)
        } catch {
            mood = previous
            actionError = "Couldn't save your check-in. Please try again."
        }
    }
}
