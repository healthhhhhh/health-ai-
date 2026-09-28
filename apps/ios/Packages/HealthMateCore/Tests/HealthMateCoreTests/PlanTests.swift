import XCTest
@testable import HealthMateCore

final class PlanScheduleTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.firstWeekday = 2 // Monday
        return c
    }()
    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private let monday = DayKey(rawValue: "2026-09-28")! // a Monday

    private func item(_ title: String, _ rule: PlanRepeat, h: Int = 9, kind: PlanItemKind = .task, start: DayKey? = nil, end: DayKey? = nil) -> PlanItem {
        PlanItem(title: title, kind: kind, time: TimeOfDay(hour: h, minute: 0), repeatRule: rule, reminderEnabled: true, source: .userReported, startDay: start ?? monday, endDay: end, createdAt: now)
    }

    func testDayKeyRoundTripAndArithmetic() {
        XCTAssertEqual(DayKey(rawValue: "2026-9-3")?.rawValue, "2026-09-03")
        XCTAssertNil(DayKey(rawValue: "2026-13-01"))
        XCTAssertEqual(monday.adding(days: 4, calendar: calendar).rawValue, "2026-10-02")
        XCTAssertTrue(monday < monday.adding(days: 1, calendar: calendar))
    }

    func testRepeatRules() {
        let tuesday = monday.adding(days: 1, calendar: calendar)
        XCTAssertTrue(PlanSchedule.occurs(item("a", .daily), on: tuesday, calendar: calendar))
        XCTAssertTrue(PlanSchedule.occurs(item("b", .weekdays([2])), on: monday, calendar: calendar))
        XCTAssertFalse(PlanSchedule.occurs(item("b", .weekdays([2])), on: tuesday, calendar: calendar))
        XCTAssertTrue(PlanSchedule.occurs(item("c", .once(tuesday)), on: tuesday, calendar: calendar))
        XCTAssertFalse(PlanSchedule.occurs(item("c", .once(tuesday)), on: monday, calendar: calendar))
    }

    func testStartAndEndDaysBoundOccurrences() {
        let tue = monday.adding(days: 1, calendar: calendar)
        let wed = monday.adding(days: 2, calendar: calendar)
        let bounded = item("course", .daily, start: tue, end: tue)
        XCTAssertFalse(PlanSchedule.occurs(bounded, on: monday, calendar: calendar))
        XCTAssertTrue(PlanSchedule.occurs(bounded, on: tue, calendar: calendar))
        XCTAssertFalse(PlanSchedule.occurs(bounded, on: wed, calendar: calendar))
    }

    func testOccurrencesAreSortedFilteredAndMarkedComplete() {
        let late = item("Late", .daily, h: 20)
        let early = item("Early", .daily, h: 7, kind: .medication)
        let completions = [PlanCompletion(itemId: late.id, day: monday, completedAt: now)]
        let all = PlanSchedule.occurrences(items: [late, early], completions: completions, on: monday, calendar: calendar)
        XCTAssertEqual(all.map(\.item.title), ["Early", "Late"])
        XCTAssertEqual(all.map(\.completed), [false, true])
        XCTAssertEqual(PlanSchedule.progress(all), .init(done: 1, total: 2))
        let meds = PlanSchedule.occurrences(items: [late, early], completions: completions, on: monday, kind: .medication, calendar: calendar)
        XCTAssertEqual(meds.map(\.item.title), ["Early"])
    }

    func testWeekStartsOnCalendarFirstWeekday() {
        let thursday = monday.adding(days: 3, calendar: calendar)
        let week = PlanSchedule.week(containing: thursday, calendar: calendar)
        XCTAssertEqual(week.count, 7)
        XCTAssertEqual(week.first, monday)
    }

    func testCannotCompleteFutureDays() {
        XCTAssertTrue(PlanSchedule.canComplete(monday, today: monday))
        XCTAssertFalse(PlanSchedule.canComplete(monday.adding(days: 1, calendar: calendar), today: monday))
    }
}

final class PlanItemDraftTests: XCTestCase {
    private let today = DayKey(rawValue: "2026-09-28")!
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    func testMedicationRequiresVerbatimInstruction() {
        var draft = PlanItemDraft(kind: .medication, today: today)
        draft.title = "Blood pressure tablet"
        XCTAssertNotNil(draft.validate().instruction)
        draft.instruction = "  One tablet each morning with food  "
        XCTAssertTrue(draft.validate().isEmpty)
        let item = draft.makeItem(existing: nil, today: today, now: now)
        XCTAssertEqual(item?.instruction, "One tablet each morning with food")
        XCTAssertEqual(item?.source, .clinicianProvided)
        XCTAssertNil(item?.notes)
    }

    func testMedicationSourceIsNeverTheApp() {
        var draft = PlanItemDraft(kind: .medication, today: today)
        draft.title = "Allergy tablet"
        draft.instruction = "As on the label"
        draft.instructionSource = .userOrLabel
        let source = draft.makeItem(existing: nil, today: today, now: now)?.source
        XCTAssertEqual(source, .userReported)
        XCTAssertNotEqual(source, .aiInferred)
    }

    func testTitleAndDaysValidation() {
        var draft = PlanItemDraft(kind: .task, today: today)
        XCTAssertNotNil(draft.validate().title)
        draft.title = String(repeating: "x", count: 81)
        XCTAssertNotNil(draft.validate().title)
        draft.title = "Stretch"
        draft.repeatKind = .weekdays
        XCTAssertNotNil(draft.validate().weekdays)
        draft.weekdays = [2, 4]
        XCTAssertTrue(draft.validate().isEmpty)
        XCTAssertNil(PlanItemDraft(kind: .task, today: today).makeItem(existing: nil, today: today, now: now))
    }

    func testEditingKeepsIdentityAndStopsBeingSample() {
        let sample = SamplePlan.document(today: today, now: now).items.first { $0.kind == .habit }!
        var draft = PlanItemDraft(editing: sample, today: today)
        draft.notes = "6 glasses"
        let edited = draft.makeItem(existing: sample, today: today, now: now.addingTimeInterval(60))!
        XCTAssertEqual(edited.id, sample.id)
        XCTAssertEqual(edited.createdAt, sample.createdAt)
        XCTAssertEqual(edited.source, .userReported)
        XCTAssertEqual(edited.notes, "6 glasses")
    }

    func testSamplePlanNeverContainsDoses() {
        let pattern = try! NSRegularExpression(pattern: #"\d+\s?(mg|mcg|iu|ml|tablet|capsule)"#, options: .caseInsensitive)
        for item in SamplePlan.document(today: today, now: now).items {
            let text = [item.title, item.notes, item.instruction].compactMap { $0 }.joined(separator: " ")
            XCTAssertEqual(pattern.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text)), 0, text)
            XCTAssertEqual(item.source, .sample)
        }
    }
}

final class PlanRepositoryTests: XCTestCase {
    func testFileRepositoryRoundTrips() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("plan.json")
        let repo = FilePlanRepository(fileURL: url)
        let empty = try await repo.load()
        XCTAssertEqual(empty, PlanDocument())
        let today = DayKey(rawValue: "2026-09-28")!
        let doc = SamplePlan.document(today: today, now: Date(timeIntervalSince1970: 1_790_000_000))
        try await repo.save(doc)
        let loaded = try await repo.load()
        XCTAssertEqual(loaded, doc)
    }

    func testCorruptFileIsReportedNotSilentlyReset() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        try Data("{not json".utf8).write(to: url)
        do {
            _ = try await FilePlanRepository(fileURL: url).load()
            XCTFail("expected unreadable")
        } catch {
            XCTAssertEqual(error as? PlanRepositoryError, .unreadable)
        }
    }
}

final class ReminderPlannerTests: XCTestCase {
    private let today = DayKey(rawValue: "2026-09-28")!
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func item(_ rule: PlanRepeat, enabled: Bool = true, kind: PlanItemKind = .medication) -> PlanItem {
        PlanItem(title: "Evening tablet", kind: kind, time: TimeOfDay(hour: 20, minute: 30), repeatRule: rule, reminderEnabled: enabled, source: .clinicianProvided, instruction: "Two tablets", startDay: today, createdAt: now)
    }

    func testPrivateByDefaultAndNeverIncludesInstructions() {
        let private_ = ReminderPlanner.requests(for: [item(.daily)], today: today, showDetails: false)
        XCTAssertEqual(private_.count, 1)
        XCTAssertFalse(private_[0].body.contains("Evening tablet"))
        let detailed = ReminderPlanner.requests(for: [item(.daily)], today: today, showDetails: true)
        XCTAssertTrue(detailed[0].body.contains("Evening tablet"))
        XCTAssertFalse(detailed[0].body.contains("Two tablets"))
    }

    func testRepeatRulesMapToRequests() {
        let weekly = ReminderPlanner.requests(for: [item(.weekdays([2, 6]))], today: today, showDetails: false)
        XCTAssertEqual(weekly.map(\.weekday), [2, 6])
        XCTAssertEqual(Set(weekly.map(\.identifier)).count, 2)
        let past = ReminderPlanner.requests(for: [item(.once(today.adding(days: -1, calendar: Calendar(identifier: .gregorian))))], today: today, showDetails: false)
        XCTAssertTrue(past.isEmpty)
        XCTAssertTrue(ReminderPlanner.requests(for: [item(.daily, enabled: false)], today: today, showDetails: false).isEmpty)
    }

    func testRespectsSystemLimit() {
        let many = (0..<40).map { _ in item(.weekdays([1, 2, 3, 4, 5, 6, 7])) }
        XCTAssertEqual(ReminderPlanner.requests(for: many, today: today, showDetails: false).count, ReminderPlanner.systemLimit)
    }
}
