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
    /// Increments when every task in today's plan becomes complete.
    private(set) var celebrationCount = 0

    private let service: any HealthDataService

    init(service: any HealthDataService) {
        self.service = service
    }

    var isSampleData: Bool { service.isSampleData }
    var tasks: [PlanTask] { summary?.tasks ?? [] }
    var progress: PlanPresenter.Progress { PlanPresenter.progress(tasks) }

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

    /// Optimistically toggles a task, rolling back if the service rejects it.
    func toggleTask(id: String) async {
        guard let index = summary?.tasks.firstIndex(where: { $0.id == id }), let current = summary?.tasks[index].completed else { return }
        let newValue = !current
        let wasComplete = progress.total > 0 && progress.done == progress.total
        summary?.tasks[index].completed = newValue
        if !wasComplete, progress.total > 0, progress.done == progress.total { celebrationCount += 1 }
        do {
            _ = try await service.setTask(id: id, completed: newValue)
        } catch {
            if let rollback = summary?.tasks.firstIndex(where: { $0.id == id }) {
                summary?.tasks[rollback].completed = current
            }
            actionError = "Couldn't update that task. Please try again."
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
