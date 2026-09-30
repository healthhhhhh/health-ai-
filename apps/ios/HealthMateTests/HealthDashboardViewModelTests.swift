import HealthMateCore
import XCTest
@testable import HealthMate

private struct DeniedReader: HealthDataReading {
    struct Denied: LocalizedError { var errorDescription: String? { "Access is off." } }
    var isAvailable: Bool { true }
    func requestAuthorization() async throws { throw Denied() }
    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue] { throw Denied() }
}

@MainActor
final class HealthDashboardViewModelTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name = "health-tests-\(UUID().uuidString)"
        return UserDefaults(suiteName: name)!
    }

    /// No server reachable: sync fails with an offline message, and nothing is lost.
    private func offlineAPI() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1
        let tokens = InMemoryTokenStore(SessionTokens(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(3600)))
        return APIClient(baseURL: URL(string: "http://127.0.0.1:9/v1")!, tokens: tokens, session: URLSession(configuration: config))
    }

    private func values(_ days: Int, _ value: Double) -> [DailyValue] {
        let today = Calendar.current.startOfDay(for: Date())
        return (1...days).map { DailyValue(date: Calendar.current.date(byAdding: .day, value: -$0, to: today)!, value: value) }
    }

    func testDeniedAccessShowsTheDeniedState() async {
        let model = HealthDashboardViewModel(reader: DeniedReader(), api: offlineAPI(), defaults: defaults())
        await model.connect()
        XCTAssertEqual(model.state, .denied("Access is off."))
    }

    func testDisconnectRemembersWhen() async {
        let store = defaults()
        let model = HealthDashboardViewModel(reader: StaticHealthReader(values: [.steps: values(14, 8000)]), api: offlineAPI(), defaults: store)
        await model.connect()
        XCTAssertEqual(model.state, .loaded)
        await model.disconnect(removeSyncedData: false)
        XCTAssertEqual(model.state, .notConnected)
        XCTAssertNotNil(model.disconnectedAt)
        XCTAssertNotNil(HealthDashboardViewModel(reader: StaticHealthReader(), api: offlineAPI(), defaults: store).disconnectedAt)
    }

    func testSyncFailureIsShownAndCanBeRetried() async {
        let store = defaults()
        let api = offlineAPI()
        let reader = StaticHealthReader(values: [.steps: values(14, 8000)])
        let sync = HealthSyncCoordinator(api: api, reader: reader, defaults: store, accountAllowsSync: { true })
        let model = HealthDashboardViewModel(reader: reader, api: api, sync: sync, defaults: store)
        await model.connect()
        await model.syncNow()
        // Offline: a plain message, and the import will resume (nothing lost).
        XCTAssertEqual(model.syncStatus, .failed(HealthSyncFailure.offline.message))
        XCTAssertNil(model.lastSyncedAt)
        XCTAssertEqual(DefaultsHealthSyncStateStore(defaults: store).load()?.lastErrorCode, "offline")
    }

    func testNothingLeavesTheIPhoneWithoutSignInAndConsent() async {
        let store = defaults()
        let reader = StaticHealthReader(values: [.steps: values(14, 8000)])
        let sync = HealthSyncCoordinator(api: offlineAPI(), reader: reader, defaults: store, accountAllowsSync: { false })
        let model = HealthDashboardViewModel(reader: reader, api: offlineAPI(), sync: sync, defaults: store)
        await model.connect()
        await model.syncNow()
        XCTAssertEqual(model.syncStatus, .idle)
        XCTAssertEqual(model.state, .loaded, "Apple Health is still shown on this iPhone")
    }

    func testDisconnectForgetsSyncProgress() async {
        let store = defaults()
        let reader = StaticHealthReader(values: [.steps: values(14, 8000)])
        let sync = HealthSyncCoordinator(api: offlineAPI(), reader: reader, defaults: store, accountAllowsSync: { true })
        let model = HealthDashboardViewModel(reader: reader, api: offlineAPI(), sync: sync, defaults: store)
        await model.connect()
        XCTAssertNotNil(DefaultsHealthSyncStateStore(defaults: store).load())
        await model.disconnect(removeSyncedData: false)
        XCTAssertNil(DefaultsHealthSyncStateStore(defaults: store).load())
    }
}
