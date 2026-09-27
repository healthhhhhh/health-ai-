import XCTest
@testable import HealthMateCore

final class HealthFormatTests: XCTestCase {
    func testGreetingByHour() {
        XCTAssertEqual(HealthFormat.greeting(hour: 5, firstName: "Alex"), "Good Morning, Alex")
        XCTAssertEqual(HealthFormat.greeting(hour: 11, firstName: "Alex"), "Good Morning, Alex")
        XCTAssertEqual(HealthFormat.greeting(hour: 12, firstName: "Alex"), "Good Afternoon, Alex")
        XCTAssertEqual(HealthFormat.greeting(hour: 17, firstName: "Alex"), "Good Evening, Alex")
        XCTAssertEqual(HealthFormat.greeting(hour: 2, firstName: "Alex"), "Good Evening, Alex")
        XCTAssertEqual(HealthFormat.greeting(hour: 9), "Good Morning")
    }

    func testDuration() {
        XCTAssertEqual(HealthFormat.duration(minutes: 432), "7h 12m")
        XCTAssertEqual(HealthFormat.duration(minutes: 45), "45m")
        XCTAssertEqual(HealthFormat.duration(minutes: 120), "2h")
        XCTAssertEqual(HealthFormat.duration(minutes: -3), "0m")
    }

    func testNumber() {
        XCTAssertEqual(HealthFormat.number(6428), "6,428")
        XCTAssertEqual(HealthFormat.number(68.5), "68.5")
    }

    func testClockTime() {
        let us = Locale(identifier: "en_US")
        // Recent ICU versions put a narrow no-break space (U+202F) before AM/PM.
        func normalized(_ s: String) -> String { s.replacingOccurrences(of: "\u{202F}", with: " ") }
        XCTAssertEqual(normalized(HealthFormat.clockTime("08:00", locale: us)), "8:00 AM")
        XCTAssertEqual(normalized(HealthFormat.clockTime("22:30", locale: us)), "10:30 PM")
        XCTAssertEqual(HealthFormat.clockTime("soon", locale: us), "soon")
        XCTAssertEqual(HealthFormat.clockTime("25:00", locale: us), "25:00")
    }

    func testRelative() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(-15), now: now), "just now")
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(-30 * 60), now: now), "30 min ago")
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(-3600), now: now), "1 hour ago")
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(-7200), now: now), "2 hours ago")
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(-86400), now: now), "yesterday")
        XCTAssertEqual(HealthFormat.relative(now.addingTimeInterval(3 * 86400), now: now), "in 3 days")
    }
}
