import Foundation

/// Pure scheduling rules for plan items.
public enum PlanSchedule {
    public static func occurs(_ item: PlanItem, on day: DayKey, calendar: Calendar) -> Bool {
        guard day >= item.startDay else { return false }
        if let end = item.endDay, day > end { return false }
        switch item.repeatRule {
        case .daily:
            return true
        case .weekdays(let weekdays):
            guard let date = day.date(in: calendar) else { return false }
            return weekdays.contains(calendar.component(.weekday, from: date))
        case .once(let only):
            return only == day
        }
    }

    /// The day's occurrences (optionally one kind), ordered by time then title.
    public static func occurrences(items: [PlanItem], completions: [PlanCompletion], on day: DayKey, kind: PlanItemKind? = nil, calendar: Calendar) -> [PlanOccurrence] {
        let done = Set(completions.filter { $0.day == day }.map(\.itemId))
        return items
            .filter { (kind == nil || $0.kind == kind) && occurs($0, on: day, calendar: calendar) }
            .sorted { ($0.time, $0.title) < ($1.time, $1.title) }
            .map { PlanOccurrence(item: $0, day: day, completed: done.contains($0.id)) }
    }

    public static func progress(_ occurrences: [PlanOccurrence]) -> PlanPresenter.Progress {
        PlanPresenter.Progress(done: occurrences.filter(\.completed).count, total: occurrences.count)
    }

    /// The seven days of the week containing `day`, starting on the calendar's first weekday.
    public static func week(containing day: DayKey, calendar: Calendar) -> [DayKey] {
        guard let date = day.date(in: calendar) else { return [day] }
        let weekday = calendar.component(.weekday, from: date)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let start = day.adding(days: -offset, calendar: calendar)
        return (0..<7).map { start.adding(days: $0, calendar: calendar) }
    }

    /// Completing is only allowed for today and past days — you can't tick off tomorrow.
    public static func canComplete(_ day: DayKey, today: DayKey) -> Bool {
        day <= today
    }
}

extension PlanPresenter {
    /// Provenance label for a plan item.
    public static func sourceLabel(_ item: PlanItem) -> String? {
        switch item.source {
        case .clinicianProvided: return "From your clinician"
        case .userReported: return item.kind == .medication ? "From your label or notes" : nil
        case .sample: return "Sample"
        default: return nil
        }
    }

    /// Subtitle for a row: the verbatim instruction for medications, notes otherwise.
    public static func detail(_ item: PlanItem) -> String? {
        let text = item.kind == .medication ? item.instruction : item.notes
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }
}
