import Foundation
@testable import HealthMateCore
import XCTest

final class AppRouteTests: XCTestCase {
    func testParsesTheSameLinksAsTheWeb() {
        XCTAssertEqual(AppRoute(link: "/reports/abc-123"), .report(id: "abc-123"))
        XCTAssertEqual(AppRoute(link: "/care/appointments/x1"), .appointment(id: "x1"))
        XCTAssertEqual(AppRoute(link: "/health/sleep"), .metric(.sleep))
        XCTAssertEqual(AppRoute(link: "/chat?c=c1"), .conversation(id: "c1"))
        XCTAssertEqual(AppRoute(link: "/plans/p1"), .planItem(id: "p1"))
        XCTAssertEqual(AppRoute(link: "/settings/account"), .account)
        XCTAssertEqual(AppRoute(link: "/notifications"), .notifications)
    }

    func testRejectsUnknownAndExternalLinks() {
        XCTAssertNil(AppRoute(link: nil))
        XCTAssertNil(AppRoute(link: "https://example.com"))
        XCTAssertNil(AppRoute(link: "//evil.example"))
        XCTAssertNil(AppRoute(link: "/unknown"))
        XCTAssertNil(AppRoute(link: "/health/blood_glucose"))
        XCTAssertNil(AppRoute(link: "/reports/../settings"))
    }

    func testRoundTripsThroughLinks() {
        let routes: [AppRoute] = [.home, .notifications, .conversation(id: "c"), .report(id: "r"), .metric(.steps), .planItem(id: "p"), .appointment(id: "a"), .timeline, .account]
        for route in routes { XCTAssertEqual(AppRoute(link: route.link), route, route.link) }
    }

    func testTimelineEntriesOpenTheirSource() {
        func event(_ type: String, _ source: String? = nil, payload: JSONValue? = nil) -> TimelineEventRecord {
            TimelineEventRecord(id: "e", eventType: type, title: "t", occurredAt: Date(), sourceType: "user_entered", sourceId: source, payload: payload)
        }
        XCTAssertEqual(AppRoute.forTimeline(event("report", "d1")), .report(id: "d1"))
        XCTAssertEqual(AppRoute.forTimeline(event("image")), .reports)
        XCTAssertEqual(AppRoute.forTimeline(event("chat", "c1")), .conversation(id: "c1"))
        XCTAssertEqual(AppRoute.forTimeline(event("appointment", "a1")), .appointment(id: "a1"))
        XCTAssertEqual(AppRoute.forTimeline(event("measurement", payload: ["kind": "sleep"])), .metric(.sleep))
        XCTAssertEqual(AppRoute.forTimeline(event("measurement", payload: ["note": "x"])), .health)
        XCTAssertEqual(AppRoute.forTimeline(event("note")), .timeline)
    }

    func testNotificationsAndAppointmentsFromThePreviewAccount() async throws {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
        let api = APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")

        let list = try await api.notifications()
        XCTAssertEqual(list.unreadCount, list.notifications.filter { !$0.isRead }.count)
        XCTAssertTrue(list.notifications.allSatisfy { $0.link == nil || AppRoute(link: $0.link) != nil }, "every sample link opens a screen")
        let unread = try XCTUnwrap(list.notifications.first { !$0.isRead })
        try await api.setNotificationRead(unread.id, read: true)
        let after = try await api.notifications()
        XCTAssertEqual(after.unreadCount, list.unreadCount - 1)
        try await api.markAllNotificationsRead()
        let none = try await api.notifications()
        XCTAssertEqual(none.unreadCount, 0)
        try await api.deleteNotification(unread.id)
        let remaining = try await api.notifications()
        XCTAssertFalse(remaining.notifications.contains { $0.id == unread.id })

        let upcoming = try await api.appointments()
        let first = try XCTUnwrap(upcoming.first)
        let fetched = try await api.appointment(first.id)
        XCTAssertEqual(fetched.title, first.title)
        if let providerId = first.careProviderId {
            let provider = try await api.careProvider(providerId)
            XCTAssertFalse(provider.name.isEmpty)
        }
        try await api.setAppointmentStatus(first.id, .cancelled)
        let cancelled = try await api.appointment(first.id)
        XCTAssertEqual(cancelled.status, .cancelled)
    }
}
