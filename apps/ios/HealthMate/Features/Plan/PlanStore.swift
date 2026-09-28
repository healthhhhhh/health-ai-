import Foundation
import HealthMateCore
import Observation

/// State for My Plan and for the plan card on Home. Local-first: every change
/// is persisted immediately and reminders are re-synced.
@MainActor
@Observable
final class PlanStore {
    enum LoadState: Equatable { case idle, loading, loaded, failed(String) }

    private(set) var state: LoadState = .idle
    private(set) var items: [PlanItem] = []
    private(set) var completions: [PlanCompletion] = []
    var selectedDay: DayKey
    /// Transient, user-facing error for a failed action.
    var actionError: String?
    /// Increments when today's plan goes from incomplete to fully done.
    private(set) var celebrationCount = 0
    private(set) var remindersDenied = false

    let calendar: Calendar
    private let repository: any PlanRepository
    private let reminders: any ReminderScheduling
    private let now: () -> Date
    private let showReminderDetails: () -> Bool

    init(
        repository: any PlanRepository,
        reminders: any ReminderScheduling,
        calendar: Calendar = .current,
        now: @escaping () -> Date = Date.init,
        showReminderDetails: @escaping () -> Bool = { UserDefaults.standard.bool(forKey: "showReminderDetails") }
    ) {
        self.repository = repository
        self.reminders = reminders
        self.calendar = calendar
        self.now = now
        self.showReminderDetails = showReminderDetails
        selectedDay = DayKey(date: now(), calendar: calendar)
    }

    var today: DayKey { DayKey(date: now(), calendar: calendar) }
    var week: [DayKey] { PlanSchedule.week(containing: selectedDay, calendar: calendar) }
    var containsSampleItems: Bool { items.contains { $0.source == .sample } }

    func occurrences(on day: DayKey, kind: PlanItemKind? = nil) -> [PlanOccurrence] {
        PlanSchedule.occurrences(items: items, completions: completions, on: day, kind: kind, calendar: calendar)
    }

    func progress(on day: DayKey, kind: PlanItemKind? = nil) -> PlanPresenter.Progress {
        PlanSchedule.progress(occurrences(on: day, kind: kind))
    }

    func canComplete(_ day: DayKey) -> Bool { PlanSchedule.canComplete(day, today: today) }

    // MARK: Loading

    func loadIfNeeded() async {
        guard state == .idle else { return }
        await load()
    }

    func load() async {
        state = .loading
        do {
            var document = try await repository.load()
            if !document.seeded {
                // First launch: offer the sample plan (labelled "Sample"), once.
                document = SamplePlan.document(today: today, now: now())
                try await repository.save(document)
            }
            apply(document)
            state = .loaded
            remindersDenied = await reminders.authorization() == .denied
        } catch {
            state = .failed("We couldn't open your plan. Your data hasn't been changed — please try again.")
        }
    }

    // MARK: Actions

    /// Optimistically toggles completion for an occurrence, rolling back on failure.
    func toggle(_ occurrence: PlanOccurrence) async {
        guard canComplete(occurrence.day) else {
            actionError = "You can mark this done on the day."
            return
        }
        let previous = completions
        let todayBefore = progress(on: today)
        if occurrence.completed {
            completions.removeAll { $0.itemId == occurrence.item.id && $0.day == occurrence.day }
        } else {
            completions.append(PlanCompletion(itemId: occurrence.item.id, day: occurrence.day, completedAt: now()))
        }
        let todayAfter = progress(on: today)
        if todayAfter.total > 0, todayAfter.done == todayAfter.total, todayBefore.done < todayBefore.total {
            celebrationCount += 1
        }
        if !(await persist()) {
            completions = previous
            actionError = "Couldn't save that change. Please try again."
        }
    }

    /// Adds or updates an item, then re-syncs reminders. Returns false on failure.
    @discardableResult
    func save(_ item: PlanItem) async -> Bool {
        let previous = items
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        } else {
            items.append(item)
        }
        guard await persist() else {
            items = previous
            actionError = "Couldn't save “\(item.title)”. Please try again."
            return false
        }
        if item.reminderEnabled { await ensureReminderPermission() }
        await syncReminders()
        return true
    }

    func delete(_ item: PlanItem) async {
        let previousItems = items
        let previousCompletions = completions
        items.removeAll { $0.id == item.id }
        completions.removeAll { $0.itemId == item.id }
        if await persist() {
            await syncReminders()
        } else {
            items = previousItems
            completions = previousCompletions
            actionError = "Couldn't delete “\(item.title)”. Please try again."
        }
    }

    /// Removes all sample items so the user starts with a clean plan.
    func removeSampleItems() async {
        for item in items where item.source == .sample { await delete(item) }
    }

    func syncReminders() async {
        let requests = ReminderPlanner.requests(for: items, today: today, showDetails: showReminderDetails())
        await reminders.replaceAll(with: requests)
    }

    // MARK: Private

    private func apply(_ document: PlanDocument) {
        items = document.items
        completions = document.completions
    }

    private func persist() async -> Bool {
        let document = PlanDocument(items: items, completions: completions, seeded: true)
        do {
            try await repository.save(document)
            return true
        } catch {
            return false
        }
    }

    private func ensureReminderPermission() async {
        switch await reminders.authorization() {
        case .authorized: remindersDenied = false
        case .denied: remindersDenied = true
        case .notDetermined: remindersDenied = !(await reminders.requestAuthorization())
        }
    }
}
