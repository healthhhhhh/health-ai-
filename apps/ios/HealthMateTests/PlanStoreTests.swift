import HealthMateCore
import XCTest
@testable import HealthMate

@MainActor
final class PlanStoreTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeStore(_ repo: InMemoryPlanRepository = InMemoryPlanRepository(), reminders: RecordingReminderScheduler = RecordingReminderScheduler()) -> PlanStore {
        let fixed = now
        return PlanStore(repository: repo, reminders: reminders, calendar: calendar, now: { fixed }, showReminderDetails: { false })
    }

    func testFirstLaunchSeedsSamplePlanOnce() async {
        let repo = InMemoryPlanRepository()
        let store = makeStore(repo)
        await store.load()
        XCTAssertEqual(store.state, .loaded)
        XCTAssertTrue(store.containsSampleItems)
        let seeded = await repo.stored()
        XCTAssertTrue(seeded.seeded)

        await store.removeSampleItems()
        XCTAssertTrue(store.items.isEmpty)
        let reloaded = makeStore(repo)
        await reloaded.load()
        XCTAssertTrue(reloaded.items.isEmpty, "sample items must not come back after removal")
    }

    func testTogglePersistsAndCelebratesWhenDayIsComplete() async {
        let repo = InMemoryPlanRepository()
        let store = makeStore(repo)
        await store.load()
        for occurrence in store.occurrences(on: store.today) where !occurrence.completed {
            await store.toggle(occurrence)
        }
        let progress = store.progress(on: store.today)
        XCTAssertEqual(progress.done, progress.total)
        XCTAssertEqual(store.celebrationCount, 1)
        let stored = await repo.stored()
        XCTAssertEqual(stored.completions.filter { $0.day == store.today }.count, progress.total)
    }

    func testToggleRollsBackWhenSaveFails() async {
        let repo = InMemoryPlanRepository()
        let store = makeStore(repo)
        await store.load()
        let open = store.occurrences(on: store.today).first { !$0.completed }!
        await repo.setFailSaves(true)
        await store.toggle(open)
        XCTAssertEqual(store.occurrences(on: store.today).first { $0.id == open.id }?.completed, false)
        XCTAssertNotNil(store.actionError)
    }

    func testFutureDaysCannotBeCompleted() async {
        let store = makeStore()
        await store.load()
        let tomorrow = store.today.adding(days: 1, calendar: calendar)
        let future = store.occurrences(on: tomorrow).first!
        await store.toggle(future)
        XCTAssertFalse(store.occurrences(on: tomorrow).first!.completed)
        XCTAssertNotNil(store.actionError)
    }

    func testSavingAnItemSchedulesPrivateRemindersAndAsksPermission() async {
        let reminders = RecordingReminderScheduler(status: .notDetermined, grants: true)
        let store = makeStore(reminders: reminders)
        await store.load()
        var draft = PlanItemDraft(kind: .medication, today: store.today)
        draft.title = "Evening tablet"
        draft.instruction = "As directed by Dr. Lee"
        let item = draft.makeItem(existing: nil, today: store.today, now: now)!
        let saved = await store.save(item)
        XCTAssertTrue(saved)
        let scheduled = await reminders.scheduled
        XCTAssertEqual(scheduled.count, 1, "sample items have reminders off; only the new item is scheduled")
        XCTAssertFalse(scheduled[0].body.contains("Evening tablet"))
        XCTAssertFalse(store.remindersDenied)
    }

    func testDeniedPermissionIsSurfaced() async {
        let store = makeStore(reminders: RecordingReminderScheduler(status: .notDetermined, grants: false))
        await store.load()
        var draft = PlanItemDraft(kind: .habit, today: store.today)
        draft.title = "Stretch"
        await store.save(draft.makeItem(existing: nil, today: store.today, now: now)!)
        XCTAssertTrue(store.remindersDenied)
    }

    func testDeleteRemovesItemAndItsCompletions() async {
        let repo = InMemoryPlanRepository()
        let store = makeStore(repo)
        await store.load()
        let done = store.occurrences(on: store.today).first { $0.completed }!.item
        await store.delete(done)
        XCTAssertFalse(store.items.contains { $0.id == done.id })
        let stored = await repo.stored()
        XCTAssertFalse(stored.completions.contains { $0.itemId == done.id })
    }
}
