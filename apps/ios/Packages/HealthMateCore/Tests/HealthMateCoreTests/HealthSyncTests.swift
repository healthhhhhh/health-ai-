import Foundation
import XCTest
@testable import HealthMateCore

/// Phase 2B: Apple Health → account sync (planner and engine).
final class HealthSyncTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/London")!
        return c
    }()

    /// 30 Sep 2026, 10:00 London.
    private var now: Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: 30, hour: 10))! }
    private func day(_ offset: Int) -> Date { calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))! }
    private func string(_ offset: Int) -> String { HealthSyncPlanner.format(day(offset), calendar) }

    // MARK: Planner

    func testFirstSyncReadsRecentDaysThenHistoryNewestFirstInChunks() {
        let chunks = HealthSyncPlanner.plan(HealthSyncState(deviceId: "d", historyDays: 90), now: now, calendar: calendar)
        XCTAssertEqual(chunks.first, HealthSyncChunk(start: day(-3), end: day(1), isHistory: false)) // last 3 days + today
        let history = chunks.filter(\.isHistory)
        XCTAssertEqual(history.first?.end, day(-3))
        XCTAssertEqual(history.last?.start, day(-89)) // 90 days including today
        for chunk in history { XCTAssertLessThanOrEqual(calendar.dateComponents([.day], from: chunk.start, to: chunk.end).day!, 30) }
        XCTAssertEqual(zip(history, history.dropFirst()).allSatisfy { $0.start == $1.end }, true, "contiguous, newest first")
    }

    func testIncrementalSyncOverlapsRecentDaysAndSkipsFinishedHistory() {
        var state = HealthSyncState(deviceId: "d", historyDays: 365)
        state.historyComplete = true
        state.lastSuccessfulSync = calendar.date(byAdding: .hour, value: -2, to: now)
        XCTAssertEqual(HealthSyncPlanner.plan(state, now: now, calendar: calendar), [HealthSyncChunk(start: day(-3), end: day(1), isHistory: false)])
        // Away for 45 days: everything since, in chunks, but no history import.
        state.lastSuccessfulSync = day(-45)
        let chunks = HealthSyncPlanner.plan(state, now: now, calendar: calendar)
        XCTAssertEqual(chunks.map(\.isHistory), [false, false])
        XCTAssertEqual(chunks.last?.start, day(-48))
    }

    func testResumesAnInterruptedImportWhereItStopped() {
        var state = HealthSyncState(deviceId: "d", historyDays: 365)
        state.lastSuccessfulSync = now
        state.historyImportedFrom = string(-120)
        let history = HealthSyncPlanner.plan(state, now: now, calendar: calendar).filter(\.isHistory)
        XCTAssertEqual(history.first?.end, day(-120))
        XCTAssertEqual(history.last?.start, day(-364))
    }

    func testMarksTodayInProgressAndKeepsOnlyDaysInTheChunk() {
        let chunk = HealthSyncChunk(start: day(-1), end: day(1), isHistory: false)
        let values = [
            DailyMetricValue(metric: .steps, day: day(-2), value: 1),
            DailyMetricValue(metric: .steps, day: day(-1), value: 8000, min: 0, max: 900, sampleCount: 40),
            DailyMetricValue(metric: .steps, day: day(0), value: 1200),
            DailyMetricValue(metric: .weight, day: day(0), value: .nan),
        ]
        let uploads = HealthSyncPlanner.uploads(values, chunk: chunk, now: now, calendar: calendar)
        XCTAssertEqual(uploads.map(\.day), ["2026-09-29", "2026-09-30"])
        XCTAssertEqual(uploads.map(\.isComplete), [true, false])
        XCTAssertEqual(uploads.first?.sampleCount, 40)
        XCTAssertEqual(uploads.first?.kind, "steps")
    }

    func testUsesTheLocalCalendarDay() {
        var tokyo = Calendar(identifier: .gregorian)
        tokyo.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        // 20:00 UTC on 30 Sep is already 1 Oct in Tokyo.
        let instant = ISO8601DateFormatter().date(from: "2026-09-30T20:00:00Z")!
        XCTAssertEqual(HealthSyncPlanner.format(tokyo.startOfDay(for: instant), tokyo), "2026-10-01")
        XCTAssertEqual(HealthSyncPlanner.parse("2026-10-01", tokyo).map { HealthSyncPlanner.format($0, tokyo) }, "2026-10-01")
        XCTAssertNil(HealthSyncPlanner.parse("not a day", tokyo))
    }

    // MARK: Engine

    func testImportsHistoryInBatchesAndReportsTheRun() async {
        let source = FakeSource(calendar: calendar)
        let uploader = FakeUploader()
        let store = MemoryHealthSyncStateStore(HealthSyncState(deviceId: "device-1", historyDays: 90))
        let engine = HealthSyncEngine(source: source, uploader: uploader, store: store, calendar: calendar, deviceName: "iPhone", now: { [now] in now })

        let outcome = await engine.sync(.connected)
        XCTAssertEqual(outcome, .succeeded(daysSent: 90, historyComplete: true))
        XCTAssertEqual(uploader.started, [.initialImport])
        XCTAssertEqual(uploader.finished.last?.status, .succeeded)
        XCTAssertEqual(uploader.finished.last?.historyComplete, true)
        XCTAssertEqual(uploader.finished.last?.oldestDay, string(-89))
        XCTAssertEqual(uploader.finished.last?.newestDay, string(0))
        XCTAssertTrue(uploader.batches.allSatisfy { $0.count <= HealthSyncEngine.batchSize })
        XCTAssertEqual(Set(uploader.batches.flatMap { $0 }.map(\.day)).count, 90)
        XCTAssertEqual(store.load()?.historyComplete, true)
        XCTAssertEqual(store.load()?.lastSuccessfulSync, now)
        let progress = await engine.progress()
        XCTAssertFalse(progress.isImportingHistory)

        // An automatic sync straight after is throttled; a manual one runs (recent days only).
        let throttled = await engine.sync(.automatic)
        XCTAssertEqual(throttled, .skipped)
        uploader.batches = []
        _ = await engine.sync(.manual)
        XCTAssertEqual(uploader.started.last, .manual)
        XCTAssertEqual(Set(uploader.batches.flatMap { $0 }.map(\.day)), Set((-3...0).map(string)))
    }

    func testOfflineKeepsProgressAndResumesLater() async {
        let source = FakeSource(calendar: calendar)
        let uploader = FakeUploader()
        let store = MemoryHealthSyncStateStore(HealthSyncState(deviceId: "d", historyDays: 365))
        let engine = HealthSyncEngine(source: source, uploader: uploader, store: store, calendar: calendar, now: { [now] in now })

        uploader.failUploadNumber = 4 // the connection drops during the 4th upload
        let first = await engine.sync(.connected)
        XCTAssertEqual(first, .failed(.offline))
        XCTAssertEqual(store.load()?.lastErrorCode, "offline")
        XCTAssertEqual(store.load()?.historyComplete, false)
        let resumeFrom = store.load()?.historyImportedFrom
        XCTAssertNotNil(resumeFrom)
        XCTAssertTrue(uploader.finished.isEmpty, "an offline failure can't be reported; the next run starts afresh")

        uploader.failUploadNumber = nil
        uploader.batches = []
        let second = await engine.sync(.automatic) // an error means the throttle doesn't apply
        guard case .succeeded(_, historyComplete: true) = second else { return XCTFail("expected the import to finish, got \(second)") }
        // Already-imported history isn't read again (only the recent overlap).
        let oldest = uploader.batches.flatMap { $0 }.map(\.day).filter { $0 < resumeFrom! }
        XCTAssertFalse(oldest.isEmpty)
        XCTAssertFalse(uploader.batches.flatMap { $0 }.map(\.day).contains(where: { $0 >= resumeFrom! && $0 < string(-3) }))
        XCTAssertNil(store.load()?.lastErrorCode)
        XCTAssertEqual(store.load()?.historyImportedFrom, string(-364))
    }

    func testStopsWhenConsentIsMissingOrSignedOut() async {
        for (error, expected) in [(APIError.server(status: 403, code: "forbidden", message: "x"), HealthSyncFailure.consentRequired), (.unauthorized, .signedOut), (.server(status: 503, code: "internal", message: "x"), .serverBusy)] {
            let uploader = FakeUploader()
            uploader.startError = error
            let store = MemoryHealthSyncStateStore(HealthSyncState(deviceId: "d", historyDays: 30))
            let engine = HealthSyncEngine(source: FakeSource(calendar: calendar), uploader: uploader, store: store, calendar: calendar, now: { [now] in now })
            let outcome = await engine.sync(.manual)
            XCTAssertEqual(outcome, .failed(expected))
            XCTAssertTrue(uploader.batches.isEmpty)
            XCTAssertEqual(store.load()?.lastErrorCode, expected.rawValue)
        }
    }

    func testSkipsARejectedBatchAndFinishesAsPartial() async {
        let uploader = FakeUploader()
        uploader.rejectUploadNumber = 1
        let store = MemoryHealthSyncStateStore(HealthSyncState(deviceId: "d", historyDays: 60))
        let engine = HealthSyncEngine(source: FakeSource(calendar: calendar), uploader: uploader, store: store, calendar: calendar, now: { [now] in now })
        let outcome = await engine.sync(.connected)
        guard case .partial = outcome else { return XCTFail("expected partial, got \(outcome)") }
        XCTAssertEqual(uploader.finished.last?.status, .partial)
        XCTAssertEqual(uploader.finished.last?.errorCode, "rejected")
        XCTAssertEqual(store.load()?.historyComplete, true, "one bad batch doesn't block the import forever")
    }

    func testHealthKitErrorStopsAndIsReported() async {
        let source = FakeSource(calendar: calendar)
        source.fail = true
        let uploader = FakeUploader()
        let engine = HealthSyncEngine(source: source, uploader: uploader, store: MemoryHealthSyncStateStore(), calendar: calendar, now: { [now] in now })
        let outcome = await engine.sync(.manual)
        XCTAssertEqual(outcome, .failed(.healthKitUnavailable))
        XCTAssertEqual(uploader.finished.last?.errorCode, "healthkit_unavailable")
    }

    func testCappedBackgroundRunsDontClaimTheyAreCurrent() async {
        let uploader = FakeUploader()
        let store = MemoryHealthSyncStateStore(HealthSyncState(deviceId: "d", historyDays: 365))
        let engine = HealthSyncEngine(source: FakeSource(calendar: calendar), uploader: uploader, store: store, calendar: calendar, now: { [now] in now })
        _ = await engine.sync(.automatic, maxChunks: 2)
        XCTAssertEqual(store.load()?.historyComplete, false)
        XCTAssertNotNil(store.load()?.lastSuccessfulSync, "the recent chunk ran")
        let progress = await engine.progress()
        XCTAssertTrue(progress.isImportingHistory)
        XCTAssertEqual(progress.historyDaysTotal, 365)
    }

    func testChoosingAShorterHistoryFinishesTheImport() async {
        var state = HealthSyncState(deviceId: "d", historyDays: 90)
        state.historyImportedFrom = string(-200) // imported further back under a longer choice
        state.lastSuccessfulSync = now
        let store = MemoryHealthSyncStateStore(state)
        let uploader = FakeUploader()
        let engine = HealthSyncEngine(source: FakeSource(calendar: calendar), uploader: uploader, store: store, calendar: calendar, now: { [now] in now })
        let outcome = await engine.sync(.manual)
        XCTAssertEqual(outcome, .succeeded(daysSent: 4, historyComplete: true))
        XCTAssertEqual(uploader.started, [.manual], "nothing older is read again")
    }

    func testClassifiesErrorsIntoPlainMessages() {
        XCTAssertEqual(HealthSyncFailure.classify(APIError.network), .offline)
        XCTAssertEqual(HealthSyncFailure.classify(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(HealthSyncFailure.classify(APIError.server(status: 429, code: "rate_limited", message: "")), .serverBusy)
        XCTAssertEqual(HealthSyncFailure.classify(APIError.server(status: 400, code: "validation_failed", message: "")), .rejected)
        XCTAssertTrue(HealthSyncFailure.offline.message.contains("safe on this iPhone"))
        for failure in [HealthSyncFailure.offline, .signedOut, .consentRequired, .serverBusy, .healthKitUnavailable, .rejected] {
            XCTAssertFalse(failure.message.lowercased().contains("abnormal"))
        }
    }

    func testStateStoreRoundTripsWithoutHealthValues() throws {
        let defaults = UserDefaults(suiteName: "HealthSyncTests-\(UUID())")!
        let store = DefaultsHealthSyncStateStore(defaults: defaults)
        var state = HealthSyncState(deviceId: "abc", historyDays: 730)
        state.historyImportedFrom = "2026-01-01"
        store.save(state)
        XCTAssertEqual(store.load(), state)
        let json = String(data: defaults.data(forKey: DefaultsHealthSyncStateStore.key)!, encoding: .utf8)!
        XCTAssertFalse(json.contains("value"))
        store.clear()
        XCTAssertNil(store.load())
    }
}

// MARK: Fakes

private final class FakeSource: DailyHealthSource, @unchecked Sendable {
    let calendar: Calendar
    var fail = false
    init(calendar: Calendar) { self.calendar = calendar }

    /// Steps and resting heart rate for every day.
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue] {
        if fail { throw NSError(domain: "HealthKit", code: 5) }
        var values: [DailyMetricValue] = []
        var day = from
        while day < to {
            values.append(DailyMetricValue(metric: .steps, day: day, value: 5000))
            values.append(DailyMetricValue(metric: .restingHeartRate, day: day, value: 60, min: 55, max: 70, sampleCount: 3))
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return values
    }
}

private final class FakeUploader: DailyHealthUploader, @unchecked Sendable {
    var started: [HealthSyncRunKind] = []
    var finished: [HealthSyncReport] = []
    var batches: [[DailyRecordUpload]] = []
    var startError: APIError?
    var failUploadNumber: Int?
    var rejectUploadNumber: Int?
    private var uploads = 0

    func startHealthSyncRun(kind: HealthSyncRunKind, deviceId: String) async throws -> String {
        if let startError { throw startError }
        started.append(kind)
        return "run-\(started.count)"
    }

    func uploadDailyHealth(_ records: [DailyRecordUpload], timeZone: String, sourceDevice: String?, syncRunId: String?) async throws -> DailyUploadResult {
        uploads += 1
        if uploads == failUploadNumber { throw APIError.network }
        if uploads == rejectUploadNumber { throw APIError.server(status: 400, code: "validation_failed", message: "Check these fields") }
        batches.append(records)
        return DailyUploadResult(upserted: records.count, unchanged: 0, ignoredOlder: 0)
    }

    func finishHealthSyncRun(_ id: String, report: HealthSyncReport) async throws {
        finished.append(report)
    }
}
