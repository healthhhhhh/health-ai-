import Foundation
@testable import HealthMateCore
import XCTest

final class HealthHistoryTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: -offset, to: calendar.startOfDay(for: Date(timeIntervalSince1970: 1_790_000_000)))!
    }

    func testOneEntryPerDayNewestFirst() {
        let days = HealthHistory.days(from: [
            .sleep: [DailyValue(date: day(2), value: 440), DailyValue(date: day(1), value: 358), DailyValue(date: day(0), value: 452)],
            .steps: [DailyValue(date: day(1), value: 7168), DailyValue(date: day(0), value: 8421)],
        ], calendar: calendar)
        XCTAssertEqual(days.map(\.date), [day(0), day(1), day(2)])
        XCTAssertEqual(days[0].values, [.sleep: 452, .steps: 8421])
        XCTAssertEqual(days[2].values, [.sleep: 440])
    }

    func testComparesWithTheirOwnUsual() {
        let sleep = [420.0, 430, 410, 425, 415, 350, 470].enumerated().map { DailyValue(date: day(6 - $0.offset), value: $0.element) }
        let days = HealthHistory.days(from: [.sleep: sleep], calendar: calendar)
        XCTAssertEqual(HealthHistory.compare(days, date: day(1), metric: .sleep).trend, .belowUsual)
        XCTAssertEqual(HealthHistory.compare(days, date: day(0), metric: .sleep).trend, .aboveUsual)
        XCTAssertEqual(HealthHistory.compare(days, date: day(4), metric: .sleep).trend, .noBaseline)
        XCTAssertEqual(HealthHistory.compare(days, date: day(0), metric: .steps).trend, .noBaseline)
    }

    func testSampleHistoryIsLongAndBelievable() {
        let series = SampleHealthSeries()
        let values = Dictionary(uniqueKeysWithValues: HealthHistory.metrics.map { ($0, series.values($0, days: 180)) })
        let days = HealthHistory.days(from: values)
        XCTAssertGreaterThanOrEqual(days.count, 170)
        for day in days.prefix(60) {
            if let rhr = day.values[.restingHeartRate], let hr = day.values[.heartRate] { XCTAssertGreaterThan(hr, rhr) }
            if let sleep = day.values[.sleep] { XCTAssertTrue((300...540).contains(sleep)) }
        }
    }
}
