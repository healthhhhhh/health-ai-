import Foundation
import HealthMateCore

/// Home data from the person's own sources: Apple Health (when connected),
/// their account profile and timeline (when signed in) and mood check-ins
/// stored on this device. A source that isn't available leaves its section
/// empty rather than failing the whole screen.
actor LiveHomeService: HealthDataService {
    nonisolated let isSampleData = false

    private let reader: any HealthDataReading
    private let api: APIClient
    private let moods: any MoodStoring
    private let isHealthConnected: @Sendable () -> Bool
    private let now: @Sendable () -> Date

    init(
        reader: any HealthDataReading,
        api: APIClient,
        moods: any MoodStoring,
        isHealthConnected: @escaping @Sendable () -> Bool = { UserDefaults.standard.bool(forKey: HealthConnection.defaultsKey) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.reader = reader
        self.api = api
        self.moods = moods
        self.isHealthConnected = isHealthConnected
        self.now = now
    }

    func homeSummary() async throws -> HomeSummary {
        let date = now()
        var inputs = HomeSummaryBuilder.Inputs(todayMood: await moods.latest())

        if reader.isAvailable && isHealthConnected() {
            var values: [TrackedMetric: [DailyValue]] = [:]
            for metric in [TrackedMetric.heartRate, .steps, .sleep, .activeEnergy] {
                values[metric] = (try? await reader.dailyValues(metric, days: 14, now: date)) ?? []
            }
            inputs.dailyValues = values
        }

        if await api.isSignedIn {
            if let details = try? await api.healthProfile().profile {
                inputs.firstName = details.firstName
                inputs.lastName = details.lastName
                inputs.timeZone = details.timeZone
            }
            inputs.timeline = (try? await api.timeline().events) ?? []
            // A check-in made on the web counts too; the newest one wins.
            if let remote = try? await api.latestMood(), remote.recordedAt > (inputs.todayMood?.recordedAt ?? .distantPast) {
                inputs.todayMood = remote
            }
        }
        return HomeSummaryBuilder.build(inputs, now: date)
    }

    /// Plan tasks are managed by `PlanStore` on this device, not through Home.
    func setTask(id: String, completed: Bool) async throws -> PlanTask {
        throw HealthDataError.notFound
    }

    func recordMood(_ mood: Mood) async throws -> MoodCheckIn {
        let checkIn = MoodCheckIn(mood: mood, recordedAt: now())
        await moods.save(checkIn)
        if await api.isSignedIn { try await api.recordMood(mood) }
        return checkIn
    }
}

enum HealthConnection {
    /// Set when the person connects Apple Health in the app (HealthKit doesn't reveal read access).
    static let defaultsKey = "appleHealthConnected"
}
