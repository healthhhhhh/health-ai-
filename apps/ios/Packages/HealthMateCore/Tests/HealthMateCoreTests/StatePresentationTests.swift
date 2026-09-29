import XCTest
@testable import HealthMateCore

final class StatePresentationTests: XCTestCase {
    func testStatesMatchTheWebCopy() {
        XCTAssertEqual(ScreenState.offline.defaultTitle, "You're offline")
        XCTAssertEqual(ScreenState.error.defaultTitle, "Something went wrong")
        XCTAssertTrue(ScreenState.error.isUrgent)
        XCTAssertFalse(ScreenState.empty.isUrgent)
    }

    func testNetworkFailuresShowTheOfflineState() {
        XCTAssertEqual(ScreenState.from(APIError.network), .offline)
        XCTAssertEqual(ScreenState.from(APIError.server(status: 500, code: "internal", message: "")), .error)
    }

    func testAIInferencesAreNeverLabelledAsFact() {
        XCTAssertEqual(Provenance.aiInferred.label, "Unconfirmed · AI suggestion")
        XCTAssertEqual(Provenance(rawValue: "user_confirmed")?.label, "Confirmed by you")
        XCTAssertEqual(Provenance(rawValue: "healthkit")?.label, "From Apple Health")
    }

    func testNotificationCategoriesDecodeFromTheAPI() throws {
        let decoded = try JSONDecoder().decode([NotificationCategory].self, from: Data(#"["medication","report"]"#.utf8))
        XCTAssertEqual(decoded, [.medication, .report])
    }
}
