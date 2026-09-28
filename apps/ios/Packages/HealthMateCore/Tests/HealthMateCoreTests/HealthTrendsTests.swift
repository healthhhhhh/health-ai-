import XCTest
@testable import HealthMateCore

final class HealthTrendsTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
    }

    func testNoBaselineWithFewDays() {
        let summary = TrendAnalysis.summarize(recent: [DailyValue(date: now, value: 8000)], baseline: [DailyValue(date: now, value: 7000)])
        XCTAssertEqual(summary.trend, .noBaseline)
        XCTAssertEqual(summary.average, 8000)
    }

    func testComparesWithOwnBaseline() {
        let baseline = (0..<7).map { DailyValue(date: day(-14 + $0), value: 6000) }
        let similar = (0..<7).map { DailyValue(date: day(-6 + $0), value: 6300) }
        let higher = (0..<7).map { DailyValue(date: day(-6 + $0), value: 9000) }
        let lower = (0..<7).map { DailyValue(date: day(-6 + $0), value: 3000) }
        XCTAssertEqual(TrendAnalysis.summarize(recent: similar, baseline: baseline).trend, .inUsualRange)
        XCTAssertEqual(TrendAnalysis.summarize(recent: higher, baseline: baseline).trend, .aboveUsual)
        XCTAssertEqual(TrendAnalysis.summarize(recent: lower, baseline: baseline).trend, .belowUsual)
    }

    func testTrendCopyNeverUsesClinicalWords() {
        for trend in [MetricTrend.inUsualRange, .aboveUsual, .belowUsual, .noBaseline] {
            let label = MetricPresenter.trendLabel(trend).lowercased()
            XCTAssertFalse(label.contains("normal"))
            XCTAssertFalse(label.contains("healthy"))
        }
    }

    func testSplitsRecentAndBaselineWindows() {
        let values = (0..<20).map { DailyValue(date: day(-$0), value: Double($0)) }
        let (recent, baseline) = TrendAnalysis.split(values, days: 7, now: now, calendar: calendar)
        XCTAssertEqual(recent.count, 7)
        XCTAssertEqual(baseline.count, 7)
        XCTAssertEqual(recent.map(\.value).max(), 6)
        XCTAssertEqual(baseline.map(\.value).min(), 7)
    }

    func testUploadsOnlyCompletedDaysWithStableIDs() {
        let values = [DailyValue(date: day(-1), value: 5000), DailyValue(date: day(0), value: 1200)]
        let uploads = TrendAnalysis.uploads(for: .steps, values: values, now: now, calendar: calendar)
        XCTAssertEqual(uploads.count, 1)
        XCTAssertEqual(uploads.first?.kind, "steps")
        XCTAssertEqual(uploads.first?.source, "apple_health")
        XCTAssertTrue(uploads.first?.externalId?.hasPrefix("apple_health:steps:") == true)
        let again = TrendAnalysis.uploads(for: .steps, values: values, now: now, calendar: calendar)
        XCTAssertEqual(again.first?.externalId, uploads.first?.externalId)
    }
}
