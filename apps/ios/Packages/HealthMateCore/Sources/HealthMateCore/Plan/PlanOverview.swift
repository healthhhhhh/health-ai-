import Foundation

/// Everything in the plan across days. Mirrors `taskOverview` in apps/web/src/lib/plan.ts.
public struct PlanOverview: Equatable, Sendable {
    /// Today, time has passed and not done yet.
    public let dueEarlier: [PlanOccurrence]
    public let laterToday: [PlanOccurrence]
    public let doneToday: [PlanOccurrence]
    /// The next days that have something planned, in order.
    public let upcoming: [Day]
    /// Earlier days in the last week that weren't done, newest first.
    public let notDone: [PlanOccurrence]

    public struct Day: Equatable, Sendable, Identifiable {
        public let day: DayKey
        public let occurrences: [PlanOccurrence]
        public var id: String { day.rawValue }
    }

    public var isTodayEmpty: Bool { dueEarlier.isEmpty && laterToday.isEmpty && doneToday.isEmpty }
}

/// One day of an item's recent history.
public enum PlanHistoryStatus: String, Sendable, Equatable {
    case done, missed, due, notScheduled

    public var label: String {
        switch self {
        case .done: "Done"
        case .missed: "Not done"
        case .due: "Due today"
        case .notScheduled: "Not scheduled"
        }
    }
}

extension PlanSchedule {
    public static func overview(items: [PlanItem], completions: [PlanCompletion], today: DayKey, now: TimeOfDay, calendar: Calendar, days: Int = 7) -> PlanOverview {
        let todays = occurrences(items: items, completions: completions, on: today, calendar: calendar)
        let open = todays.filter { !$0.completed }
        return PlanOverview(
            dueEarlier: open.filter { !(now < $0.item.time) },
            laterToday: open.filter { now < $0.item.time },
            doneToday: todays.filter(\.completed),
            upcoming: (1..<days).compactMap { offset in
                let day = today.adding(days: offset, calendar: calendar)
                let list = occurrences(items: items, completions: completions, on: day, calendar: calendar)
                return list.isEmpty ? nil : PlanOverview.Day(day: day, occurrences: list)
            },
            notDone: (1..<days).flatMap { offset in
                occurrences(items: items, completions: completions, on: today.adding(days: -offset, calendar: calendar), calendar: calendar).filter { !$0.completed }
            }
        )
    }

    /// The last `days` days (oldest first) for one item.
    public static func history(_ item: PlanItem, completions: [PlanCompletion], today: DayKey, days: Int = 7, calendar: Calendar) -> [(day: DayKey, status: PlanHistoryStatus)] {
        let done = Set(completions.filter { $0.itemId == item.id }.map(\.day))
        return (0..<days).map { index in
            let day = today.adding(days: index - (days - 1), calendar: calendar)
            let status: PlanHistoryStatus = !occurs(item, on: day, calendar: calendar) ? .notScheduled : done.contains(day) ? .done : day == today ? .due : .missed
            return (day, status)
        }
    }

    /// Done / scheduled over the last `days` days, not counting today while it's still due.
    public static func adherence(_ item: PlanItem, completions: [PlanCompletion], today: DayKey, days: Int = 7, calendar: Calendar) -> (done: Int, scheduled: Int) {
        let counted = history(item, completions: completions, today: today, days: days, calendar: calendar).filter { $0.status == .done || $0.status == .missed }
        return (counted.filter { $0.status == .done }.count, counted.count)
    }
}

extension PlanPresenter {
    /// "Every day", "Weekdays", "Mon, Wed, Fri", "Once, on 12 Oct". Same wording as the web.
    public static func describeRepeat(_ rule: PlanRepeat, calendar: Calendar) -> String {
        switch rule {
        case .daily:
            return "Every day"
        case .weekdays(let days):
            let sorted = days.sorted()
            if sorted == [2, 3, 4, 5, 6] { return "Weekdays" }
            if sorted == [1, 7] { return "Weekends" }
            let names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            return sorted.compactMap { (1...7).contains($0) ? names[$0 - 1] : nil }.joined(separator: ", ")
        case .once(let day):
            let date = day.date(in: calendar) ?? Date()
            return "Once, on \(date.formatted(.dateTime.month(.abbreviated).day()))"
        }
    }
}

/// One medication from the plan (with reminders) and/or the health profile.
public struct UnifiedMedication: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// Exactly as entered: the plan's instruction, else the profile's. Never merged or rewritten.
    public let instruction: String?
    public let planItem: PlanItem?
    public let profile: MedicationRecord?
}

public enum MedicationList {
    /// Plan and profile medications matched by name (case-insensitive). Mirrors `unifiedMedications` on web.
    public static func unify(items: [PlanItem], profile: [MedicationRecord]) -> [UnifiedMedication] {
        let active = profile.filter(\.active)
        func same(_ a: String, _ b: String) -> Bool {
            a.trimmingCharacters(in: .whitespaces).lowercased() == b.trimmingCharacters(in: .whitespaces).lowercased()
        }
        let fromPlan = items.filter { $0.kind == .medication }.sorted { $0.title < $1.title }.map { item in
            let match = active.first { same($0.name, item.title) }
            return UnifiedMedication(id: item.id.uuidString, name: item.title, instruction: item.instruction ?? match?.instruction, planItem: item, profile: match)
        }
        let matched = Set(fromPlan.compactMap { $0.profile?.id })
        let profileOnly = active.filter { !matched.contains($0.id) }.sorted { $0.name < $1.name }.map {
            UnifiedMedication(id: "profile-\($0.id)", name: $0.name, instruction: $0.instruction, planItem: nil, profile: $0)
        }
        return fromPlan + profileOnly
    }
}
