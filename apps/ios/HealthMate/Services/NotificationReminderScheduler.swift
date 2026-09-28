import Foundation
import HealthMateCore
import UserNotifications

/// Schedules plan reminders as local notifications. Only identifiers with the
/// plan prefix are touched, so other notifications are never removed.
final class NotificationReminderScheduler: ReminderScheduling {
    private var center: UNUserNotificationCenter { .current() }

    func authorization() async -> ReminderAuthorization {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        default: return .authorized
        }
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func replaceAll(with requests: [ReminderRequest]) async {
        let pending = await center.pendingNotificationRequests()
        let stale = pending.map(\.identifier).filter { $0.hasPrefix(ReminderPlanner.identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: stale)

        var calendar = Calendar.current
        calendar.timeZone = .current
        for request in requests {
            let content = UNMutableNotificationContent()
            content.title = request.title
            content.body = request.body
            content.sound = .default
            content.threadIdentifier = "plan"

            var components = DateComponents(hour: request.hour, minute: request.minute)
            var repeats = true
            if let weekday = request.weekday { components.weekday = weekday }
            if let day = request.date, let date = day.date(in: calendar) {
                let ymd = calendar.dateComponents([.year, .month, .day], from: date)
                components.year = ymd.year
                components.month = ymd.month
                components.day = ymd.day
                repeats = false
            }
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: repeats)
            try? await center.add(UNNotificationRequest(identifier: request.identifier, content: content, trigger: trigger))
        }
    }
}

/// No-op scheduler for tests and previews; records what would be scheduled.
actor RecordingReminderScheduler: ReminderScheduling {
    private(set) var scheduled: [ReminderRequest] = []
    private var status: ReminderAuthorization
    private let grants: Bool

    init(status: ReminderAuthorization = .authorized, grants: Bool = true) {
        self.status = status
        self.grants = grants
    }

    func authorization() async -> ReminderAuthorization { status }

    func requestAuthorization() async -> Bool {
        status = grants ? .authorized : .denied
        return grants
    }

    func replaceAll(with requests: [ReminderRequest]) async { scheduled = requests }
}
