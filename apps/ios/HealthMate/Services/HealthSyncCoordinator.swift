import Foundation
import HealthMateCore
import Observation

/// Keeps the person's account in step with Apple Health on this iPhone:
/// imports their chosen history once (resuming if interrupted), then keeps
/// recent days current — when the app opens, when HealthKit reports new data
/// (background delivery) and when they tap "Sync now".
///
/// Nothing leaves the iPhone unless they're signed in *and* have turned on the
/// Apple Health sync consent. Preview mode syncs only when asked (sample data).
@MainActor
@Observable
final class HealthSyncCoordinator {
    enum Status: Equatable {
        case idle, syncing
        case succeeded(String)
        case failed(String)
    }

    private(set) var status: Status = .idle
    private(set) var progress: HealthSyncProgress?
    private(set) var lastSyncedAt: Date?

    private let api: APIClient
    private let reader: any HealthDataReading
    private let defaults: UserDefaults
    private let store: DefaultsHealthSyncStateStore
    private let engine: HealthSyncEngine
    /// Signed in with the Apple Health sync consent on.
    private let accountAllowsSync: () -> Bool
    private let isPreview: () -> Bool
    private let onSignedOut: () -> Void
    private var observing = false

    /// Shown when a sync found nothing to upload (no data, or read access not given — HealthKit doesn't say which).
    static let nothingNewMessage = "Nothing new to sync."

    /// Background runs import at most this many 30-day chunks, so they finish within HealthKit's time limit.
    static let backgroundChunkLimit = 4

    init(
        api: APIClient,
        reader: any HealthDataReading,
        defaults: UserDefaults = .standard,
        accountAllowsSync: @escaping () -> Bool,
        isPreview: @escaping () -> Bool = { false },
        onSignedOut: @escaping () -> Void = {}
    ) {
        self.api = api
        self.reader = reader
        self.defaults = defaults
        self.accountAllowsSync = accountAllowsSync
        self.isPreview = isPreview
        self.onSignedOut = onSignedOut
        store = DefaultsHealthSyncStateStore(defaults: defaults)
        engine = HealthSyncEngine(source: HealthReaderSource(reader: reader), uploader: api, store: store, deviceName: "iPhone")
        // The previous (manual) sync remembered its last run here.
        lastSyncedAt = store.load()?.lastSuccessfulSync ?? defaults.object(forKey: "hmHealthLastSyncedAt") as? Date
        if let state = store.load() { progress = Self.progress(state) }
    }

    convenience init(session: SessionStore, reader: any HealthDataReading) {
        self.init(
            api: session.api,
            reader: reader,
            accountAllowsSync: { [weak session] in session.map { $0.isSignedIn && $0.hasConsent("health_data_sync") } ?? false },
            isPreview: { [weak session] in session?.isPreview ?? false },
            onSignedOut: { [weak session] in session?.handle(APIError.unauthorized) }
        )
    }

    var isConnected: Bool { reader.isAvailable && defaults.bool(forKey: HealthConnection.defaultsKey) }
    /// Signed in, consented and connected: the account can receive Apple Health data.
    var canSync: Bool { isConnected && accountAllowsSync() }
    var syncing: Bool { status == .syncing }

    var historyLength: HealthHistoryLength {
        HealthHistoryLength(rawValue: store.load()?.historyDays ?? HealthHistoryLength.oneYear.rawValue) ?? .oneYear
    }

    /// Apple Health was just connected (or reconnected): start the history import.
    func connected(history: HealthHistoryLength) async {
        await engine.reset(historyDays: history.rawValue)
        progress = await engine.progress()
        guard canSync else { return }
        let state = await engine.state
        // Best effort: the account shows what's shared and how much history was requested.
        _ = try? await api.connectHealthKit(deviceName: "iPhone", deviceId: state.deviceId, scopes: TrackedMetric.allCases.map(\.rawValue), historyDays: history.rawValue)
        await run(.connected)
    }

    /// Changes how much history to import; the import continues from where it is.
    func setHistoryLength(_ length: HealthHistoryLength) async {
        guard var state = store.load(), state.historyDays != length.rawValue else { return }
        state.historyDays = length.rawValue
        state.historyComplete = false // a longer window has more to import; a shorter one finishes at once
        store.save(state)
        progress = await engine.progress()
        if canSync { await run(.manual) }
    }

    /// App opened or came to the foreground.
    func syncIfNeeded() async {
        guard canSync, !isPreview() else { return }
        await run(.automatic)
        startObserving()
    }

    func syncNow() async {
        guard canSync else { return }
        await run(.manual)
    }

    /// Apple Health disconnected on this iPhone: forget sync progress (the account keeps or deletes data as chosen).
    func disconnected() {
        store.clear()
        progress = nil
        status = .idle
    }

    private func startObserving() {
        guard !observing, let healthKit = reader as? HealthKitService else { return }
        observing = true
        healthKit.observeChanges { [weak self] in
            await self?.backgroundSync()
        }
    }

    private func backgroundSync() async {
        guard canSync, !syncing else { return }
        await run(.automatic, maxChunks: Self.backgroundChunkLimit)
    }

    private func run(_ trigger: HealthSyncEngine.Trigger, maxChunks: Int? = nil) async {
        guard !syncing else { return }
        status = .syncing
        progress = await engine.progress()
        let outcome = await engine.sync(trigger, maxChunks: maxChunks) { [weak self] progress in
            Task { @MainActor in self?.progress = progress }
        }
        progress = await engine.progress()
        lastSyncedAt = store.load()?.lastSuccessfulSync ?? lastSyncedAt
        switch outcome {
        case .skipped:
            status = .idle
        case .succeeded(let days, _):
            status = .succeeded(days == 0 ? Self.nothingNewMessage : "Synced \(days) day\(days == 1 ? "" : "s") of Apple Health data.")
        case .partial:
            status = .failed(HealthSyncFailure.rejected.message)
        case .failed(let failure):
            if failure == .signedOut { onSignedOut() }
            status = .failed(failure.message)
        }
    }

    private static func progress(_ state: HealthSyncState) -> HealthSyncProgress? {
        state.historyComplete ? HealthSyncProgress(historyDaysImported: state.historyDays, historyDaysTotal: state.historyDays) : nil
    }
}
