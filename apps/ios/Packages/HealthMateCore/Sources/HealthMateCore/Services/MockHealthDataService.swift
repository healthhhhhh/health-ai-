import Foundation

/// In-memory service backed by `SampleData`. Used until the backend exists.
/// Everything it returns is tagged `.sample`.
public actor MockHealthDataService: HealthDataService {
    public nonisolated let isSampleData = true
    private var summary: HomeSummary
    private let latency: Duration

    public init(now: Date = Date(), latency: Duration = .zero) {
        self.summary = SampleData.homeSummary(now: now)
        self.latency = latency
    }

    public func homeSummary() async throws -> HomeSummary {
        try await simulateLatency()
        return summary
    }

    public func setTask(id: String, completed: Bool) async throws -> PlanTask {
        try await simulateLatency()
        guard let index = summary.tasks.firstIndex(where: { $0.id == id }) else { throw HealthDataError.notFound }
        summary.tasks[index].completed = completed
        return summary.tasks[index]
    }

    public func recordMood(_ mood: Mood) async throws -> MoodCheckIn {
        try await simulateLatency()
        let checkIn = MoodCheckIn(mood: mood, recordedAt: Date())
        summary.todayMood = checkIn
        return checkIn
    }

    private func simulateLatency() async throws {
        if latency > .zero { try await Task.sleep(for: latency) }
    }
}
