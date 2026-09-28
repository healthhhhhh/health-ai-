import HealthMateCore
import XCTest
@testable import HealthMate

/// A service whose writes can be made to fail, to test optimistic rollback.
private actor FlakyService: HealthDataService {
    nonisolated let isSampleData = true
    private let inner = MockHealthDataService()
    var failWrites = false
    var failReads = false

    func setFailWrites(_ value: Bool) { failWrites = value }
    func setFailReads(_ value: Bool) { failReads = value }

    func homeSummary() async throws -> HomeSummary {
        if failReads { throw HealthDataError.network }
        return try await inner.homeSummary()
    }

    func setTask(id: String, completed: Bool) async throws -> PlanTask {
        if failWrites { throw HealthDataError.network }
        return try await inner.setTask(id: id, completed: completed)
    }

    func recordMood(_ mood: Mood) async throws -> MoodCheckIn {
        if failWrites { throw HealthDataError.network }
        return try await inner.recordMood(mood)
    }
}

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testLoadsSummary() async {
        let model = HomeViewModel(service: MockHealthDataService())
        await model.loadIfNeeded()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.summary?.user.firstName, "Alex")
        XCTAssertTrue(model.isSampleData)
    }

    func testLoadFailureShowsError() async {
        let service = FlakyService()
        await service.setFailReads(true)
        let model = HomeViewModel(service: service)
        await model.load()
        guard case .failed = model.state else { return XCTFail("expected failure state") }
    }

    func testMoodRollsBackOnFailure() async {
        let service = FlakyService()
        let model = HomeViewModel(service: service)
        await model.load()
        await service.setFailWrites(true)
        await model.selectMood(.great)
        XCTAssertNil(model.mood)
        XCTAssertNotNil(model.actionError)
    }
}
