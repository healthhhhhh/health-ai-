import Foundation

// Apple Health → account sync (Phase 2B). Pure logic, unit-tested; the app
// supplies the HealthKit reader and the API. See docs/phase2b-plan.md.

/// One day of one metric as HealthKit computed it (already de-duplicated across iPhone and Apple Watch).
public struct DailyMetricValue: Equatable, Sendable {
    public let metric: TrackedMetric
    /// Start of the local day (sleep: the day the person woke up).
    public let day: Date
    public let value: Double
    public var min: Double?
    public var max: Double?
    public var sampleCount: Int?

    public init(metric: TrackedMetric, day: Date, value: Double, min: Double? = nil, max: Double? = nil, sampleCount: Int? = nil) {
        self.metric = metric
        self.day = day
        self.value = value
        self.min = min
        self.max = max
        self.sampleCount = sampleCount
    }
}

/// `PUT /v1/health-data/daily` record.
public struct DailyRecordUpload: Codable, Equatable, Sendable {
    public let day: String
    public let kind: String
    public let value: Double
    public let min: Double?
    public let max: Double?
    public let sampleCount: Int?
    /// false for today (still in progress).
    public let isComplete: Bool
    public let computedAt: Date
}

public struct DailyUploadResult: Codable, Equatable, Sendable {
    public let upserted: Int
    public let unchanged: Int
    public let ignoredOlder: Int
    public init(upserted: Int, unchanged: Int, ignoredOlder: Int) {
        self.upserted = upserted
        self.unchanged = unchanged
        self.ignoredOlder = ignoredOlder
    }
}

/// How much Apple Health history to import when connecting.
public enum HealthHistoryLength: Int, CaseIterable, Codable, Identifiable, Sendable {
    case threeMonths = 90
    case oneYear = 365
    case twoYears = 730

    public var id: Int { rawValue }
    public var label: String {
        switch self {
        case .threeMonths: return "3 months"
        case .oneYear: return "1 year"
        case .twoYears: return "2 years"
        }
    }
}

public enum HealthSyncRunKind: String, Codable, Sendable {
    case initialImport = "initial_import"
    case incremental
    case manual
}

/// Saved on the device between syncs. No health values — dates and codes only.
public struct HealthSyncState: Codable, Equatable, Sendable {
    /// Random per install; lets the server tell the person's devices apart.
    public var deviceId: String
    public var historyDays: Int
    /// Oldest day already imported ("yyyy-MM-dd"); the import works newest → oldest.
    public var historyImportedFrom: String?
    public var historyComplete: Bool
    public var lastSuccessfulSync: Date?
    public var lastAttempt: Date?
    public var lastErrorCode: String?

    public init(deviceId: String = UUID().uuidString, historyDays: Int = HealthHistoryLength.oneYear.rawValue) {
        self.deviceId = deviceId
        self.historyDays = historyDays
        historyComplete = false
    }
}

public protocol HealthSyncStateStore: Sendable {
    func load() -> HealthSyncState?
    func save(_ state: HealthSyncState)
    func clear()
}

/// `UserDefaults`-backed state (dates and codes only).
public final class DefaultsHealthSyncStateStore: HealthSyncStateStore, @unchecked Sendable {
    public static let key = "hmHealthSyncState"
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func load() -> HealthSyncState? {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(HealthSyncState.self, from: $0) }
    }
    public func save(_ state: HealthSyncState) {
        if let data = try? JSONEncoder().encode(state) { defaults.set(data, forKey: Self.key) }
    }
    public func clear() { defaults.removeObject(forKey: Self.key) }
}

public final class MemoryHealthSyncStateStore: HealthSyncStateStore, @unchecked Sendable {
    private let lock = NSLock()
    private var state: HealthSyncState?
    public init(_ state: HealthSyncState? = nil) { self.state = state }
    public func load() -> HealthSyncState? { lock.lock(); defer { lock.unlock() }; return state }
    public func save(_ state: HealthSyncState) { lock.lock(); self.state = state; lock.unlock() }
    public func clear() { lock.lock(); state = nil; lock.unlock() }
}

/// A range of days to read and upload: [start, end) as local start-of-day dates.
public struct HealthSyncChunk: Equatable, Sendable {
    public let start: Date
    public let end: Date
    /// Part of the first history import (vs. keeping recent days current).
    public let isHistory: Bool
}

/// Decides which days a sync reads. First the recent days (so today shows up
/// quickly): everything since the last successful sync plus the last
/// `overlapDays` again (late Apple Watch and sleep data) and today (in
/// progress). Then, until the chosen history is imported, older days in
/// `chunkDays` chunks, newest first, so an interrupted import resumes where it stopped.
public enum HealthSyncPlanner {
    public static let overlapDays = 3
    public static let chunkDays = 30

    public static func plan(_ state: HealthSyncState, now: Date, calendar: Calendar) -> [HealthSyncChunk] {
        let today = calendar.startOfDay(for: now)
        let tomorrow = day(1, from: today, calendar)
        let historyStart = day(-(max(state.historyDays, 1) - 1), from: today, calendar)

        var recentStart = day(-overlapDays, from: state.lastSuccessfulSync.map { calendar.startOfDay(for: $0) } ?? today, calendar)
        recentStart = max(min(recentStart, today), historyStart)
        var chunks = split(from: recentStart, to: tomorrow, isHistory: false, calendar)

        if !state.historyComplete {
            let importedFrom = state.historyImportedFrom.flatMap { parse($0, calendar) }
            let frontier = min(importedFrom ?? recentStart, recentStart)
            if frontier > historyStart { chunks += split(from: historyStart, to: frontier, isHistory: true, calendar) }
        }
        return chunks
    }

    /// Newest chunk first.
    private static func split(from start: Date, to end: Date, isHistory: Bool, _ calendar: Calendar) -> [HealthSyncChunk] {
        var chunks: [HealthSyncChunk] = []
        var upper = end
        while upper > start {
            let lower = max(day(-chunkDays, from: upper, calendar), start)
            chunks.append(HealthSyncChunk(start: lower, end: upper, isHistory: isHistory))
            upper = lower
        }
        return chunks
    }

    static func day(_ offset: Int, from date: Date, _ calendar: Calendar) -> Date {
        calendar.date(byAdding: .day, value: offset, to: date) ?? date
    }

    public static func format(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    public static func parse(_ string: String, _ calendar: Calendar) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// Upload records for one chunk: only days inside it; today (and later) marked in progress.
    public static func uploads(_ values: [DailyMetricValue], chunk: HealthSyncChunk, now: Date, calendar: Calendar) -> [DailyRecordUpload] {
        let today = calendar.startOfDay(for: now)
        return values
            .filter { $0.day >= chunk.start && $0.day < chunk.end && $0.value.isFinite }
            .map { v in
                DailyRecordUpload(
                    day: format(v.day, calendar),
                    kind: v.metric.rawValue,
                    value: v.value,
                    min: v.min,
                    max: v.max,
                    sampleCount: v.sampleCount,
                    isComplete: v.day < today,
                    computedAt: now
                )
            }
    }
}

/// Reads HealthKit (the app's `HealthKitService`; a fake in tests).
public protocol DailyHealthSource: Sendable {
    /// All tracked metrics for local days in [from, to).
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue]
}

/// The account side (`APIClient`; a fake in tests).
public protocol DailyHealthUploader: Sendable {
    func startHealthSyncRun(kind: HealthSyncRunKind, deviceId: String) async throws -> String
    func uploadDailyHealth(_ records: [DailyRecordUpload], timeZone: String, sourceDevice: String?, syncRunId: String?) async throws -> DailyUploadResult
    func finishHealthSyncRun(_ id: String, report: HealthSyncReport) async throws
}

public struct HealthSyncReport: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case succeeded, partial, failed }
    public var status: Status
    public var daysSent: Int
    public var recordsUpserted: Int
    public var oldestDay: String?
    public var newestDay: String?
    public var errorCode: String?
    public var historyComplete: Bool
}

/// Why a sync stopped, with what to tell the person. Progress so far is always kept.
public enum HealthSyncFailure: String, Equatable, Sendable, Codable {
    case offline
    case signedOut = "signed_out"
    case consentRequired = "consent_required"
    case serverBusy = "server_busy"
    case healthKitUnavailable = "healthkit_unavailable"
    case rejected

    public var message: String {
        switch self {
        case .offline: return "You're offline, so nothing was synced. We'll sync when you're back online — your data is safe on this iPhone."
        case .signedOut: return "Sign in again to keep syncing Apple Health to your account."
        case .consentRequired: return "Turn on Apple Health sync in Settings › Privacy to save it to your account."
        case .serverBusy: return "HealthMate couldn't sync right now. We'll try again shortly."
        case .healthKitUnavailable: return "Apple Health didn't respond. Try again in a moment."
        case .rejected: return "Some days couldn't be synced. The rest are saved."
        }
    }

    public static func classify(_ error: Error) -> HealthSyncFailure {
        switch error as? APIError {
        case .network?: return .offline
        case .unauthorized?: return .signedOut
        case .server(403, _, _)?: return .consentRequired
        case .server(let status, _, _)? where status == 429 || status >= 500: return .serverBusy
        case .server?, .decoding?: return .rejected
        case .aiUnavailable?: return .serverBusy
        case nil: return error is URLError ? .offline : .healthKitUnavailable
        }
    }
}

public enum HealthSyncOutcome: Equatable, Sendable {
    /// Synced recently; nothing to do.
    case skipped
    case succeeded(daysSent: Int, historyComplete: Bool)
    /// Finished, but some batches were rejected.
    case partial(daysSent: Int)
    case failed(HealthSyncFailure)
}

public struct HealthSyncProgress: Equatable, Sendable {
    /// Days of history imported so far, and the total chosen.
    public let historyDaysImported: Int
    public let historyDaysTotal: Int
    public var isImportingHistory: Bool { historyDaysImported < historyDaysTotal }
}

/// Runs one sync: reads each chunk, uploads it in batches, saves progress after
/// every chunk so an interrupted import resumes where it stopped.
public actor HealthSyncEngine {
    public enum Trigger: Sendable { case automatic, manual, connected }

    public static let batchSize = 500
    /// Automatic syncs run at most this often.
    public static let minimumInterval: TimeInterval = 15 * 60

    private let source: any DailyHealthSource
    private let uploader: any DailyHealthUploader
    private let store: any HealthSyncStateStore
    private let calendar: Calendar
    private let now: @Sendable () -> Date
    private let deviceName: String?
    private var running = false

    public init(source: any DailyHealthSource, uploader: any DailyHealthUploader, store: any HealthSyncStateStore, calendar: Calendar = .current, deviceName: String? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.source = source
        self.uploader = uploader
        self.store = store
        self.calendar = calendar
        self.deviceName = deviceName
        self.now = now
    }

    public var state: HealthSyncState { store.load() ?? HealthSyncState() }

    public func progress() -> HealthSyncProgress {
        let state = self.state
        guard !state.historyComplete else { return HealthSyncProgress(historyDaysImported: state.historyDays, historyDaysTotal: state.historyDays) }
        let today = calendar.startOfDay(for: now())
        let from = state.historyImportedFrom.flatMap { HealthSyncPlanner.parse($0, calendar) } ?? today
        let days = (calendar.dateComponents([.day], from: from, to: today).day ?? 0) + 1
        return HealthSyncProgress(historyDaysImported: min(max(days, 0), state.historyDays), historyDaysTotal: state.historyDays)
    }

    /// Starts over with a new history length (e.g. after reconnecting).
    public func reset(historyDays: Int) {
        let deviceId = store.load()?.deviceId ?? UUID().uuidString
        store.save(HealthSyncState(deviceId: deviceId, historyDays: historyDays))
    }

    public func sync(_ trigger: Trigger, maxChunks: Int? = nil, onProgress: (@Sendable (HealthSyncProgress) -> Void)? = nil) async -> HealthSyncOutcome {
        guard !running else { return .skipped }
        var state = self.state
        let date = now()
        if trigger == .automatic, state.historyComplete, state.lastErrorCode == nil,
           let last = state.lastSuccessfulSync, date.timeIntervalSince(last) < Self.minimumInterval {
            return .skipped
        }
        running = true
        defer { running = false }

        var chunks = HealthSyncPlanner.plan(state, now: date, calendar: calendar)
        let plannedRecent = chunks.filter { !$0.isHistory }.count
        if let maxChunks { chunks = Array(chunks.prefix(maxChunks)) }
        let kind: HealthSyncRunKind = chunks.contains(where: \.isHistory) ? .initialImport : trigger == .manual ? .manual : .incremental
        state.lastAttempt = date
        store.save(state)

        let runId: String
        do {
            runId = try await uploader.startHealthSyncRun(kind: kind, deviceId: state.deviceId)
        } catch {
            return fail(HealthSyncFailure.classify(error), state: &state)
        }

        var report = HealthSyncReport(status: .succeeded, daysSent: 0, recordsUpserted: 0, historyComplete: state.historyComplete)
        var sentDays = Set<String>()
        var rejected = false
        let historyStart = HealthSyncPlanner.day(-(max(state.historyDays, 1) - 1), from: calendar.startOfDay(for: date), calendar)

        for chunk in chunks {
            let values: [DailyMetricValue]
            do {
                values = try await source.dailyMetricValues(from: chunk.start, to: chunk.end)
            } catch {
                return await finish(runId, report: &report, failure: .healthKitUnavailable, state: &state)
            }
            let uploads = HealthSyncPlanner.uploads(values, chunk: chunk, now: date, calendar: calendar)
            for start in stride(from: 0, to: uploads.count, by: Self.batchSize) {
                let batch = Array(uploads[start..<min(start + Self.batchSize, uploads.count)])
                do {
                    let result = try await uploader.uploadDailyHealth(batch, timeZone: calendar.timeZone.identifier, sourceDevice: deviceName, syncRunId: runId)
                    report.recordsUpserted += result.upserted
                    for record in batch { sentDays.insert(record.day) }
                } catch {
                    let failure = HealthSyncFailure.classify(error)
                    guard failure == .rejected else { return await finish(runId, report: &report, failure: failure, state: &state) }
                    rejected = true // skip the bad batch; keep going
                }
            }
            // Progress is saved per chunk: an interruption resumes here.
            let chunkStart = HealthSyncPlanner.format(chunk.start, calendar)
            report.daysSent = sentDays.count
            report.oldestDay = min(report.oldestDay ?? chunkStart, chunkStart)
            report.newestDay = max(report.newestDay ?? chunkStart, HealthSyncPlanner.format(HealthSyncPlanner.day(-1, from: chunk.end, calendar), calendar))
            if chunk.isHistory || chunk.start <= historyStart {
                state.historyImportedFrom = min(state.historyImportedFrom ?? chunkStart, chunkStart)
                if chunk.start <= historyStart { state.historyComplete = true }
            } else if state.historyImportedFrom == nil {
                state.historyImportedFrom = chunkStart
            }
            store.save(state)
            onProgress?(progress())
        }

        // Already imported further back than needed (e.g. the person chose a shorter history).
        if let from = state.historyImportedFrom.flatMap({ HealthSyncPlanner.parse($0, calendar) }), from <= historyStart { state.historyComplete = true }
        // Recent days are current only if every recent chunk ran (a capped background run may stop early).
        if chunks.filter({ !$0.isHistory }).count == plannedRecent { state.lastSuccessfulSync = date }
        state.lastErrorCode = rejected ? HealthSyncFailure.rejected.rawValue : nil
        store.save(state)
        report.status = rejected ? .partial : .succeeded
        report.errorCode = rejected ? HealthSyncFailure.rejected.rawValue : nil
        report.historyComplete = state.historyComplete
        try? await uploader.finishHealthSyncRun(runId, report: report)
        return rejected ? .partial(daysSent: report.daysSent) : .succeeded(daysSent: report.daysSent, historyComplete: state.historyComplete)
    }

    private func fail(_ failure: HealthSyncFailure, state: inout HealthSyncState) -> HealthSyncOutcome {
        state.lastErrorCode = failure.rawValue
        store.save(state)
        return .failed(failure)
    }

    private func finish(_ runId: String, report: inout HealthSyncReport, failure: HealthSyncFailure, state: inout HealthSyncState) async -> HealthSyncOutcome {
        let outcome = fail(failure, state: &state)
        report.status = .failed
        report.errorCode = failure.rawValue
        report.historyComplete = state.historyComplete
        // Best effort: when offline this won't arrive; the next sync starts a new run.
        if failure != .offline && failure != .signedOut { try? await uploader.finishHealthSyncRun(runId, report: report) }
        return outcome
    }
}
