import XCTest
@testable import HealthMateCore

final class HomeSummaryBuilderTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
    }

    private func event(_ id: String, _ type: String, _ title: String, _ offsetHours: Double, source: String = "user_entered") -> TimelineEventRecord {
        TimelineEventRecord(id: id, eventType: type, title: title, occurredAt: now.addingTimeInterval(offsetHours * 3600), sourceType: source, sourceId: nil)
    }

    func testEmptyInputsProduceAnHonestEmptySummary() {
        let summary = HomeSummaryBuilder.build(.init(), now: now, calendar: calendar)
        XCTAssertEqual(summary.user.firstName, "")
        XCTAssertTrue(summary.metrics.isEmpty)
        XCTAssertTrue(summary.recentActivity.isEmpty)
        XCTAssertTrue(summary.upcomingAppointments.isEmpty)
        XCTAssertNil(summary.insight, "No AI insight is invented")
        XCTAssertEqual(summary.unreadNotifications, 0)
    }

    func testUsesTodaysAppleHealthValuesOnly() {
        let steps = (0..<14).map { DailyValue(date: day(-$0), value: $0 == 0 ? 4200 : 8000) }
        let sleep = [DailyValue(date: day(-1), value: 420)] // nothing for today → not shown
        let summary = HomeSummaryBuilder.build(.init(dailyValues: [.steps: steps, .sleep: sleep]), now: now, calendar: calendar)
        XCTAssertEqual(summary.metrics.map(\.kind), [.steps])
        XCTAssertEqual(summary.metrics.first?.value, 4200)
        XCTAssertEqual(summary.metrics.first?.source, .appleHealth)
    }

    func testMapsActiveEnergyToCalories() {
        let energy = (0..<8).map { DailyValue(date: day(-$0), value: 300) }
        let summary = HomeSummaryBuilder.build(.init(dailyValues: [.activeEnergy: energy]), now: now, calendar: calendar)
        XCTAssertEqual(summary.metrics.first?.kind, .calories)
        XCTAssertEqual(summary.metrics.first?.unit, "kcal")
    }

    func testRecentActivityIsPastTimelineNewestFirst() {
        let timeline = [
            event("a", "report", "Blood test uploaded", -30, source: "document"),
            event("b", "note", "Started a walking habit", -2),
            event("c", "appointment", "Dentist", 48),
            event("d", "chat", "Asked about sleep", -5),
        ]
        let summary = HomeSummaryBuilder.build(.init(timeline: timeline), now: now, calendar: calendar)
        XCTAssertEqual(summary.recentActivity.map(\.id), ["b", "d", "a"])
        XCTAssertEqual(summary.recentActivity.map(\.kind), [.note, .chat, .report])
        XCTAssertEqual(summary.recentActivity.last?.source, .documentExtracted)
    }

    func testUpcomingAppointmentsComeFromFutureAppointmentEntries() {
        let timeline = [event("c", "appointment", "Dentist", 48), event("e", "appointment", "Past visit", -48), event("f", "note", "Future note", 10)]
        let summary = HomeSummaryBuilder.build(.init(timeline: timeline), now: now, calendar: calendar)
        XCTAssertEqual(summary.upcomingAppointments.map(\.title), ["Dentist"])
        XCTAssertEqual(summary.upcomingAppointments.first?.clinicianName, "", "No clinician is invented")
    }

    func testOnlyTodaysMoodIsShown() {
        let yesterday = MoodCheckIn(mood: .low, recordedAt: now.addingTimeInterval(-86_400))
        XCTAssertNil(HomeSummaryBuilder.build(.init(todayMood: yesterday), now: now, calendar: calendar).todayMood)
        let today = MoodCheckIn(mood: .good, recordedAt: now)
        XCTAssertEqual(HomeSummaryBuilder.build(.init(todayMood: today), now: now, calendar: calendar).todayMood?.mood, .good)
    }

    func testMoodStorePersists() async {
        let defaults = UserDefaults(suiteName: "mood-test-\(UUID().uuidString)")!
        let store = UserDefaultsMoodStore(defaults: defaults)
        let empty = await store.latest()
        XCTAssertNil(empty)
        await store.save(MoodCheckIn(mood: .great, recordedAt: now))
        let reloaded = await UserDefaultsMoodStore(defaults: defaults).latest()
        XCTAssertEqual(reloaded?.mood, .great)
    }
}
