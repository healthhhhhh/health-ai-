import Foundation
import HealthMateCore
import Observation

@MainActor
@Observable
final class HealthDashboardViewModel {
    enum State: Equatable { case notConnected, unavailable, loading, loaded, failed(String) }

    private(set) var state: State = .notConnected
    var periodDays = 7
    private(set) var series: [TrackedMetric: [DailyValue]] = [:]
    private(set) var syncing = false
    private(set) var lastSyncMessage: String?

    private let reader: any HealthDataReading
    private let api: APIClient
    private let defaults: UserDefaults
    private let now: () -> Date
    private static let connectedKey = HealthConnection.defaultsKey

    init(reader: any HealthDataReading, api: APIClient, defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.reader = reader
        self.api = api
        self.defaults = defaults
        self.now = now
        if !reader.isAvailable {
            state = .unavailable
        } else if defaults.bool(forKey: Self.connectedKey) {
            state = .loading
        }
    }

    var isConnected: Bool { defaults.bool(forKey: Self.connectedKey) && reader.isAvailable }

    func connect() async {
        guard reader.isAvailable else { state = .unavailable; return }
        do {
            try await reader.requestAuthorization()
            defaults.set(true, forKey: Self.connectedKey)
            await load()
        } catch {
            state = .failed("We couldn't connect to Apple Health. Please try again.")
        }
    }

    /// Stops reading on this device. Apple Health itself is unchanged.
    func disconnect(removeSyncedData: Bool) async {
        defaults.set(false, forKey: Self.connectedKey)
        series = [:]
        state = .notConnected
        if removeSyncedData { try? await api.disconnectAppleHealth() }
    }

    func load() async {
        guard isConnected else { return }
        if series.isEmpty { state = .loading }
        var next: [TrackedMetric: [DailyValue]] = [:]
        // Twice the period: the earlier half is the person's own baseline.
        for metric in TrackedMetric.allCases {
            next[metric] = (try? await reader.dailyValues(metric, days: periodDays * 2, now: now())) ?? []
        }
        series = next
        state = .loaded
    }

    func values(_ metric: TrackedMetric) -> [DailyValue] {
        TrendAnalysis.split(series[metric] ?? [], days: periodDays, now: now()).recent
    }

    func summary(_ metric: TrackedMetric) -> TrendSummary {
        let parts = TrendAnalysis.split(series[metric] ?? [], days: periodDays, now: now())
        return TrendAnalysis.summarize(recent: parts.recent, baseline: parts.baseline)
    }

    var hasAnyData: Bool { series.values.contains { !$0.isEmpty } }

    /// Uploads completed days to the person's account (requires the health_data_sync consent).
    func sync() async {
        guard isConnected, !syncing else { return }
        syncing = true
        defer { syncing = false }
        let uploads = TrackedMetric.allCases.flatMap { TrendAnalysis.uploads(for: $0, values: series[$0] ?? [], now: now()) }
        guard !uploads.isEmpty else { lastSyncMessage = "Nothing new to sync."; return }
        do {
            var inserted = 0
            for start in stride(from: 0, to: uploads.count, by: 500) {
                inserted += try await api.uploadMeasurements(Array(uploads[start..<min(start + 500, uploads.count)]))
            }
            lastSyncMessage = inserted == 0 ? "Already up to date." : "Synced \(inserted) day\(inserted == 1 ? "" : "s") of data."
        } catch {
            lastSyncMessage = (error as? LocalizedError)?.errorDescription ?? "Sync didn't complete. Please try again."
        }
    }
}
