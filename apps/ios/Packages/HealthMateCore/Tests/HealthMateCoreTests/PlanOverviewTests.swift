import XCTest
@testable import HealthMateCore

final class PlanOverviewTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private let created = Date(timeIntervalSince1970: 1_780_000_000)
    private let start = DayKey(rawValue: "2026-09-01")!
    private let today = DayKey(rawValue: "2026-09-10")!

    private lazy var walk = PlanItem(title: "Walk", kind: .habit, time: TimeOfDay(hour: 19, minute: 0), repeatRule: .daily, reminderEnabled: true, source: .userReported, startDay: start, createdAt: created)
    private lazy var med = PlanItem(title: "Example medicine", kind: .medication, time: TimeOfDay(hour: 8, minute: 0), repeatRule: .daily, reminderEnabled: true, source: .userReported, instruction: "As written on the label", startDay: start, createdAt: created)
    private lazy var call = PlanItem(title: "Call clinic", kind: .task, time: TimeOfDay(hour: 10, minute: 0), repeatRule: .once(DayKey(rawValue: "2026-09-12")!), reminderEnabled: true, source: .userReported, startDay: start, createdAt: created)
    private var completions: [PlanCompletion] {
        [
            PlanCompletion(itemId: med.id, day: DayKey(rawValue: "2026-09-10")!, completedAt: created),
            PlanCompletion(itemId: med.id, day: DayKey(rawValue: "2026-09-09")!, completedAt: created),
            PlanCompletion(itemId: walk.id, day: DayKey(rawValue: "2026-09-09")!, completedAt: created),
        ]
    }

    func testOverviewSortsTodayUpcomingAndNotDone() {
        let items = [walk, med, call]
        let o = PlanSchedule.overview(items: items, completions: completions, today: today, now: TimeOfDay(hour: 12, minute: 0), calendar: calendar)
        XCTAssertTrue(o.dueEarlier.isEmpty)
        XCTAssertEqual(o.doneToday.map(\.item.title), ["Example medicine"])
        XCTAssertEqual(o.laterToday.map(\.item.title), ["Walk"])
        XCTAssertEqual(o.upcoming.first?.day.rawValue, "2026-09-11")
        XCTAssertEqual(o.upcoming.first { $0.day.rawValue == "2026-09-12" }?.occurrences.map(\.item.title), ["Example medicine", "Call clinic", "Walk"])
        XCTAssertFalse(o.notDone.contains { $0.day.rawValue == "2026-09-09" })
        XCTAssertEqual(o.notDone.first { $0.day.rawValue == "2026-09-08" }?.item.title, "Example medicine")
        let evening = PlanSchedule.overview(items: items, completions: completions, today: today, now: TimeOfDay(hour: 20, minute: 0), calendar: calendar)
        XCTAssertEqual(evening.dueEarlier.map(\.item.title), ["Walk"])
    }

    func testAdherenceCountsScheduledDaysOnlyAndNotTodayWhileDue() {
        XCTAssertTrue(PlanSchedule.adherence(med, completions: completions, today: today, calendar: calendar) == (2, 7))
        XCTAssertTrue(PlanSchedule.adherence(walk, completions: completions, today: today, calendar: calendar) == (1, 6))
        XCTAssertEqual(PlanSchedule.history(walk, completions: completions, today: today, calendar: calendar).last?.status, .due)
    }

    func testRepeatWordingMatchesTheWeb() {
        XCTAssertEqual(PlanPresenter.describeRepeat(.daily, calendar: calendar), "Every day")
        XCTAssertEqual(PlanPresenter.describeRepeat(.weekdays([2, 3, 4, 5, 6]), calendar: calendar), "Weekdays")
        XCTAssertEqual(PlanPresenter.describeRepeat(.weekdays([2, 4, 6]), calendar: calendar), "Mon, Wed, Fri")
    }

    func testMedicationsJoinByNameWithoutRewritingInstructions() {
        let list = MedicationList.unify(items: [walk, med], profile: [
            MedicationRecord(id: "p1", name: "example MEDICINE ", instruction: "Profile wording", source: .userReported, active: true),
            MedicationRecord(id: "p2", name: "Other medicine", instruction: "Its own wording", source: .clinicianProvided, active: true),
            MedicationRecord(id: "p3", name: "Stopped", instruction: "x", source: .userReported, active: false),
        ])
        XCTAssertEqual(list.map(\.instruction), ["As written on the label", "Its own wording"])
        XCTAssertEqual(list.first?.profile?.id, "p1")
        XCTAssertNil(list.last?.planItem)
        XCTAssertEqual(list.last?.id, "profile-p2")
    }
}
