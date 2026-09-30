import Foundation
import HealthMateCore
import Observation

/// Health tab: reads Apple Health (sample data in Preview mode), summarises
/// each metric against the person's own baseline, and optionally syncs
/// completed days to their account.
@MainActor
@Observable
final class HealthDashboardViewModel {
    enum State: Equatable {
        case notConnected, unavailable, loading, loaded
        /// Access to Apple Health was refused; it can only be turned on in Settings.
        case denied(String)
        case failed(String)
    }

    /// Account sync status, shown on the dashboard (owned by the app-wide `HealthSyncCoordinator`).
    typealias SyncStatus = HealthSyncCoordinator.Status

    static let periods = [7, 30, 90]

    private(set) var state: State = .notConnected
    var periodDays = 7
    private(set) var series: [TrackedMetric: [DailyValue]] = [:]
    /// When the person last disconnected (so the connect card can say so).
    private(set) var disconnectedAt: Date?
    /// A data type was added since the person last answered the Apple Health sheet.
    private(set) var needsAccessReview = false
    /// How much history to import when connecting.
    var historyLength: HealthHistoryLength

    let sync: HealthSyncCoordinator
    private let reader: any HealthDataReading
    private let api: APIClient
    private let defaults: UserDefaults
    private let now: () -> Date
    private static let connectedKey = HealthConnection.defaultsKey
    private static let disconnectedKey = "hmHealthDisconnectedAt"

    var syncStatus: SyncStatus { sync.status }
    var lastSyncedAt: Date? { sync.lastSyncedAt }
    var syncProgress: HealthSyncProgress? { sync.progress }

    /// `sync` is the app-wide coordinator; without one (e.g. a metric opened from Home) nothing is uploaded from here.
    init(reader: any HealthDataReading, api: APIClient, sync: HealthSyncCoordinator? = nil, defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.reader = reader
        self.api = api
        let sync = sync ?? HealthSyncCoordinator(api: api, reader: reader, defaults: defaults, accountAllowsSync: { false })
        self.sync = sync
        self.defaults = defaults
        self.now = now
        historyLength = sync.historyLength
        disconnectedAt = defaults.object(forKey: Self.disconnectedKey) as? Date
        if !reader.isAvailable {
            state = .unavailable
        } else if defaults.bool(forKey: Self.connectedKey) {
            state = .loading
        }
    }

    var isConnected: Bool { defaults.bool(forKey: Self.connectedKey) && reader.isAvailable }
    var syncing: Bool { sync.syncing }

    func connect() async {
        guard reader.isAvailable else { state = .unavailable; return }
        do {
            try await reader.requestAuthorization()
            defaults.set(true, forKey: Self.connectedKey)
            defaults.removeObject(forKey: Self.disconnectedKey)
            disconnectedAt = nil
            needsAccessReview = false
            await load()
            // Imports the chosen history in the background of this screen (only when sync is on).
            await sync.connected(history: historyLength)
        } catch {
            state = .denied((error as? LocalizedError)?.errorDescription ?? "Apple Health access is turned off for HealthMate. Turn it on in Settings › Health › Data Access & Devices.")
        }
    }

    /// Shows "Review Apple Health access" when the permission sheet has something new to ask.
    func checkAccess() async {
        guard isConnected else { return }
        needsAccessReview = await reader.shouldRequestAuthorization()
    }

    /// Stops reading on this device. Apple Health itself is unchanged.
    func disconnect(removeSyncedData: Bool) async {
        defaults.set(false, forKey: Self.connectedKey)
        let date = now()
        defaults.set(date, forKey: Self.disconnectedKey)
        disconnectedAt = date
        series = [:]
        state = .notConnected
        sync.disconnected()
        if removeSyncedData { try? await api.disconnectAppleHealth() }
    }

    func load() async {
        guard isConnected else { return }
        if series.isEmpty { state = .loading }
        var next: [TrackedMetric: [DailyValue]] = [:]
        // Twice the period: the earlier half is the person's own baseline.
        do {
            for metric in TrackedMetric.allCases {
                next[metric] = try await reader.dailyValues(metric, days: periodDays * 2, now: now())
            }
        } catch {
            if series.isEmpty { state = .denied((error as? LocalizedError)?.errorDescription ?? "Apple Health access is turned off for HealthMate.") }
            return
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

    /// Days in the loaded series (newest first) — today's snapshot compares with these.
    var days: [HealthDay] { HealthHistory.days(from: series) }

    /// Syncs Apple Health to the person's account now (requires the health_data_sync consent).
    /// The first sync also imports the chosen history; later ones keep recent days current.
    func syncNow() async {
        guard isConnected else { return }
        await sync.syncNow()
    }

    func setHistoryLength(_ length: HealthHistoryLength) async {
        historyLength = length
        await sync.setHistoryLength(length)
    }
}

/// Loads a long run of days for the daily health history (independent of the dashboard's period).
@MainActor
@Observable
final class HealthHistoryViewModel {
    private(set) var days: [HealthDay] = []
    private(set) var state: ScreenState? = .loading

    private let reader: any HealthDataReading
    private let now: () -> Date

    init(reader: any HealthDataReading, now: @escaping () -> Date = Date.init) {
        self.reader = reader
        self.now = now
    }

    func load(days count: Int = 90) async {
        if days.isEmpty { state = .loading }
        var series: [TrackedMetric: [DailyValue]] = [:]
        do {
            // The extra month gives the oldest shown days a "usual" to compare with.
            for metric in HealthHistory.metrics { series[metric] = try await reader.dailyValues(metric, days: count + 30, now: now()) }
        } catch {
            state = .permission
            return
        }
        days = HealthHistory.days(from: series)
        state = days.isEmpty ? .empty : nil
    }

    /// Days to list (the extra comparison month is kept for "your usual" but not shown).
    func shown(_ count: Int = 90) -> [HealthDay] { Array(days.prefix(count)) }
}
