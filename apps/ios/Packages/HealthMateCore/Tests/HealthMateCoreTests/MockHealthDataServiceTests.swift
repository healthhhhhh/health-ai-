import XCTest
@testable import HealthMateCore

final class MockHealthDataServiceTests: XCTestCase {
    func testEverythingIsLabelledSample() async throws {
        let service = MockHealthDataService()
        let s = try await service.homeSummary()
        XCTAssertTrue(service.isSampleData)
        XCTAssertTrue(s.metrics.allSatisfy { $0.source == .sample })
        XCTAssertTrue(s.tasks.allSatisfy { $0.source == .sample })
        XCTAssertTrue(s.recentActivity.allSatisfy { $0.source == .sample })
        XCTAssertEqual(s.insight?.source, .sample)
    }

    func testSampleMedicationTasksNeverContainDoses() async throws {
        let s = try await MockHealthDataService().homeSummary()
        let pattern = try NSRegularExpression(pattern: #"\d+\s?(mg|mcg|iu|ml)\b"#, options: .caseInsensitive)
        for task in s.tasks where task.category == .medication {
            let text = "\(task.title) \(task.detail ?? "")"
            XCTAssertEqual(pattern.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text)), 0, text)
        }
    }

    func testTaskCompletionPersists() async throws {
        let service = MockHealthDataService()
        _ = try await service.setTask(id: "t2", completed: true)
        let s = try await service.homeSummary()
        XCTAssertEqual(s.tasks.first { $0.id == "t2" }?.completed, true)
    }

    func testUnknownTaskThrows() async {
        do {
            _ = try await MockHealthDataService().setTask(id: "nope", completed: true)
            XCTFail("expected notFound")
        } catch {
            XCTAssertEqual(error as? HealthDataError, .notFound)
        }
    }

    func testRecordMood() async throws {
        let service = MockHealthDataService()
        _ = try await service.recordMood(.good)
        let mood = try await service.homeSummary().todayMood?.mood
        XCTAssertEqual(mood, .good)
    }

    func testDecodesWebContractJSON() throws {
        let json = #"{"id":"t1","title":"Drink water","category":"hydration","scheduledTime":"09:00","completed":false,"source":"clinician_provided"}"#
        let task = try JSONCoding.makeDecoder().decode(PlanTask.self, from: Data(json.utf8))
        XCTAssertEqual(task.source, .clinicianProvided)
        XCTAssertNotNil(JSONCoding.parseISO8601("2026-09-27T10:00:00.123Z"))
        XCTAssertNotNil(JSONCoding.parseISO8601("2026-09-27T10:00:00Z"))
    }
}
