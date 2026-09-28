import Foundation

public enum ReminderAuthorization: Sendable, Equatable {
    case notDetermined, denied, authorized
}

/// A platform-neutral notification request. The app turns these into
/// UNNotificationRequests; keeping the rules here makes them testable.
public struct ReminderRequest: Equatable, Sendable {
    public let identifier: String
    public let title: String
    public let body: String
    public let hour: Int
    public let minute: Int
    /// Repeating weekly on this weekday (1 = Sunday); nil with `date` nil means every day.
    public let weekday: Int?
    /// A one-off date; when set the reminder does not repeat.
    public let date: DayKey?
}

public protocol ReminderScheduling: Sendable {
    func authorization() async -> ReminderAuthorization
    func requestAuthorization() async -> Bool
    func replaceAll(with requests: [ReminderRequest]) async
}

public enum ReminderPlanner {
    public static let identifierPrefix = "plan."
    /// iOS keeps at most 64 pending local notifications per app.
    public static let systemLimit = 64

    /// Builds reminder requests for enabled items, soonest-relevant first.
    ///
    /// Privacy: unless `showDetails` is on, reminders say only that something is
    /// due, so health details never appear on a locked screen. Medication
    /// instructions are never put in a notification.
    public static func requests(for items: [PlanItem], today: DayKey, showDetails: Bool, limit: Int = systemLimit) -> [ReminderRequest] {
        var result: [ReminderRequest] = []
        for item in items.sorted(by: { $0.time < $1.time }) where item.reminderEnabled {
            if let end = item.endDay, end < today { continue }
            let body = showDetails ? "\(item.kind == .medication ? "Time for" : "Reminder:") \(item.title)" : "You have something due in your plan."
            let base = "\(identifierPrefix)\(item.id.uuidString)"
            switch item.repeatRule {
            case .daily:
                result.append(ReminderRequest(identifier: base, title: "HealthMate", body: body, hour: item.time.hour, minute: item.time.minute, weekday: nil, date: nil))
            case .weekdays(let days):
                for day in days.sorted() {
                    result.append(ReminderRequest(identifier: "\(base).\(day)", title: "HealthMate", body: body, hour: item.time.hour, minute: item.time.minute, weekday: day, date: nil))
                }
            case .once(let day):
                guard day >= today else { continue }
                result.append(ReminderRequest(identifier: base, title: "HealthMate", body: body, hour: item.time.hour, minute: item.time.minute, weekday: nil, date: day))
            }
        }
        return Array(result.prefix(limit))
    }
}
