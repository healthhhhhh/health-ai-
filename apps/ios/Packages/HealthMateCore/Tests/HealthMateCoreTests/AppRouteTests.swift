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

final class PreviewChatTests: XCTestCase {
    private func client(_ state: PreviewState = .normal) -> APIClient {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { state }
        return APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
    }

    func testRenamesAConversationAndTitlesItsTimelineEntry() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let start = try await api.startConversation("Tips for sleeping better")
        let renamed = try await api.renameConversation(start.conversation.id, title: "My sleep routine")
        XCTAssertEqual(renamed.title, "My sleep routine")
        let timeline = try await api.timeline()
        XCTAssertEqual(timeline.events.first { $0.sourceId == start.conversation.id }?.title, "AI chat: Tips for sleeping better")
    }

    func testAIUnavailableRefusesMessagesButKeepsHistory() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        PreviewURLProtocol.state = { .aiUnavailable }
        let meta = try await api.meta()
        XCTAssertEqual(meta.ai.available, false)
        do {
            _ = try await api.startConversation("hello")
            XCTFail("expected the assistant to be unavailable")
        } catch APIError.aiUnavailable {
            // expected: the app shows its "AI answers are unavailable" state
        }
        let history = try await api.conversations()
        XCTAssertFalse(history.isEmpty)
    }
}

final class PreviewTimelineTests: XCTestCase {
    func testFiltersAddEditAndDelete() async throws {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
        let api = APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")

        let symptoms = try await api.timeline(types: TimelineFilter.symptoms.eventTypes)
        XCTAssertFalse(symptoms.events.isEmpty)
        XCTAssertTrue(symptoms.events.allSatisfy { $0.eventType == "symptom" })
        let reports = try await api.timeline(types: TimelineFilter.reports.eventTypes)
        XCTAssertTrue(reports.events.allSatisfy { ["report", "image"].contains($0.eventType) })

        try await api.addTimelineEntry(type: "note", title: "Felt dizzy after standing", occurredAt: Date(), details: "Passed after a minute")
        let notes = try await api.timeline(types: ["note"])
        let added = try XCTUnwrap(notes.events.first { $0.title == "Felt dizzy after standing" })
        XCTAssertEqual(added.details, "Passed after a minute")
        XCTAssertTrue(added.isEditable)

        try await api.updateTimelineEntry(added.id, title: "Felt lightheaded after standing", occurredAt: added.occurredAt, details: nil)
        let editedNotes = try await api.timeline(types: ["note"])
        let edited = try XCTUnwrap(editedNotes.events.first { $0.id == added.id })
        XCTAssertEqual(edited.title, "Felt lightheaded after standing")
        XCTAssertNil(edited.details)

        let fromReport = try XCTUnwrap(reports.events.first)
        XCTAssertFalse(fromReport.isEditable, "entries from reports can't be edited")
        try await api.deleteTimelineEntry(added.id)
        let after = try await api.timeline(types: ["note"])
        XCTAssertFalse(after.events.contains { $0.id == added.id })
    }
}
