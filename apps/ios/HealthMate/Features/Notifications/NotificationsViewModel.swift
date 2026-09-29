import Foundation
import HealthMateCore
import Observation

/// The notification centre: load, filter, open (marks read), mark all read and delete.
/// Changes show immediately and roll back if the server refuses them.
@MainActor
@Observable
final class NotificationsViewModel {
    enum Filter: Hashable {
        case all, unread
        case category(NotificationCategory)
    }

    struct Group: Identifiable {
        let title: String
        let items: [NotificationRecord]
        var id: String { title }
    }

    private(set) var notifications: [NotificationRecord] = []
    private(set) var state: ScreenState? = .loading
    var filter: Filter = .all
    var errorMessage: String?

    private let api: APIClient
    private let now: () -> Date
    private let calendar: Calendar

    init(api: APIClient, now: @escaping () -> Date = Date.init, calendar: Calendar = .current) {
        self.api = api
        self.now = now
        self.calendar = calendar
    }

    var unreadCount: Int { notifications.filter { !$0.isRead }.count }

    /// Categories that have at least one notification, in a fixed order.
    var categories: [NotificationCategory] { NotificationCategory.allCases.filter { c in notifications.contains { $0.category == c } } }

    var groups: [Group] {
        let shown = notifications.filter { n in
            switch filter {
            case .all: true
            case .unread: !n.isRead
            case .category(let c): n.category == c
            }
        }
        let today = shown.filter { calendar.isDate($0.createdAt, inSameDayAs: now()) }
        let earlier = shown.filter { !calendar.isDate($0.createdAt, inSameDayAs: now()) }
        return [Group(title: "Today", items: today), Group(title: "Earlier", items: earlier)].filter { !$0.items.isEmpty }
    }

    func load() async {
        if notifications.isEmpty { state = .loading }
        do {
            notifications = try await api.notifications().notifications.sorted { $0.createdAt > $1.createdAt }
            state = notifications.isEmpty ? .empty : nil
        } catch {
            state = notifications.isEmpty ? ScreenState.from(error) : nil
            if !notifications.isEmpty { errorMessage = (error as? LocalizedError)?.errorDescription }
        }
    }

    /// Marks it read and returns where it leads (nil if it has no in-app destination).
    func open(_ notification: NotificationRecord) async -> AppRoute? {
        if !notification.isRead { await setRead(notification, true) }
        return AppRoute(link: notification.link)
    }

    func setRead(_ notification: NotificationRecord, _ read: Bool) async {
        let before = notifications
        update(notification.id) { $0.readAt = read ? (notification.readAt ?? self.now()) : nil }
        do {
            try await api.setNotificationRead(notification.id, read: read)
        } catch {
            notifications = before
            errorMessage = "Couldn't update the notification. Please try again."
        }
    }

    func markAllRead() async {
        let before = notifications
        let date = now()
        notifications = notifications.map { var n = $0; if n.readAt == nil { n.readAt = date }; return n }
        do {
            try await api.markAllNotificationsRead()
        } catch {
            notifications = before
            errorMessage = "Couldn't mark notifications as read. Please try again."
        }
    }

    func delete(_ notification: NotificationRecord) async {
        let before = notifications
        notifications.removeAll { $0.id == notification.id }
        if notifications.isEmpty { state = .empty }
        do {
            try await api.deleteNotification(notification.id)
        } catch {
            notifications = before
            state = nil
            errorMessage = "Couldn't delete the notification. Please try again."
        }
    }

    private func update(_ id: String, _ change: (inout NotificationRecord) -> Void) {
        guard let index = notifications.firstIndex(where: { $0.id == id }) else { return }
        change(&notifications[index])
    }
}
