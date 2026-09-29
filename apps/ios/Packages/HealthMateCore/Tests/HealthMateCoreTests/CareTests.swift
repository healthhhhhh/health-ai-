import Foundation
@testable import HealthMateCore
import XCTest

final class CareTests: XCTestCase {
    private func appt(_ id: String, _ offset: TimeInterval, _ status: AppointmentRecord.Status = .scheduled) -> AppointmentRecord {
        AppointmentRecord(id: id, title: id, careProviderId: nil, providerName: nil, startsAt: Date(timeIntervalSince1970: 1_800_000_000 + offset), endsAt: nil, location: nil, mode: nil, status: status, notes: nil)
    }

    func testSplitsUpcomingFromPastLikeTheWeb() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let split = AppointmentList.split([appt("later", 900_000), appt("soon", 90_000), appt("done", -800_000), appt("cancelled", 400_000, .cancelled)], now: now)
        XCTAssertEqual(split.upcoming.map(\.id), ["soon", "later"])
        XCTAssertEqual(split.past.map(\.id), ["cancelled", "done"])
    }

    func testPrepChecklistRoundTripsInTheWebFormat() {
        let text = AppointmentPrep.serialize(notes: "Bring medication list", questions: [PrepQuestion(text: "What should I expect?", done: false), PrepQuestion(text: "Any results?", done: true)])
        XCTAssertEqual(text, "Bring medication list\n\nQuestions to ask:\n- [ ] What should I expect?\n- [x] Any results?")
        let parsed = AppointmentPrep.parse(text)
        XCTAssertEqual(parsed.notes, "Bring medication list")
        XCTAssertEqual(parsed.questions, [PrepQuestion(text: "What should I expect?", done: false), PrepQuestion(text: "Any results?", done: true)])
        XCTAssertEqual(AppointmentPrep.parse("Just notes").questions, [])
        XCTAssertNil(AppointmentPrep.serialize(notes: "", questions: []))
    }

    func testDraftsSendNullsSoEditsCanClearFields() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let draft = AppointmentDraft(title: "Check-up", careProviderId: nil, startsAt: Date(timeIntervalSince1970: 1_800_000_000), endsAt: nil, mode: .video, location: nil, notes: nil)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(draft)) as? [String: Any])
        XCTAssertTrue(json["location"] is NSNull)
        XCTAssertEqual(json["mode"] as? String, "video")
        XCTAssertEqual(CareProviderDraft(name: " ", specialty: nil, phone: nil, address: nil, website: nil, notes: nil).problem, "Add a name.")
        XCTAssertNotNil(CareProviderDraft(name: "Dr. A", specialty: nil, phone: nil, address: nil, website: "not a site", notes: nil).problem)
        XCTAssertNil(CareProviderDraft(name: "Dr. A", specialty: nil, phone: nil, address: nil, website: "https://example.com", notes: nil).problem)
    }
}

final class PreviewCareTests: XCTestCase {
    override func setUp() {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
    }

    func testCareTeamAndAppointmentsRoundTripThroughTheClient() async throws {
        let api = APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let providerID = try await api.saveCareProvider(id: nil, CareProviderDraft(name: "Dr. Test", specialty: "GP", phone: nil, address: nil, website: nil, notes: nil))
        let start = Date().addingTimeInterval(86_400 * 3)
        let id = try await api.saveAppointment(id: nil, AppointmentDraft(title: "First visit", careProviderId: providerID, startsAt: start, endsAt: nil, mode: .phone, location: "Clinic", notes: nil))
        var saved = try await api.appointment(id)
        XCTAssertEqual(saved.providerName, "Dr. Test")
        XCTAssertEqual(saved.mode, .phone)
        try await api.saveAppointment(id: id, AppointmentDraft(title: "First visit", careProviderId: providerID, startsAt: start, endsAt: nil, mode: .phone, location: nil, notes: nil))
        saved = try await api.appointment(id)
        XCTAssertNil(saved.location, "an edit can clear a field")
        try await api.setAppointmentNotes(id, AppointmentPrep.serialize(notes: "", questions: [PrepQuestion(text: "Q?", done: true)]))
        saved = try await api.appointment(id)
        XCTAssertEqual(AppointmentPrep.parse(saved.notes).questions, [PrepQuestion(text: "Q?", done: true)])
        try await api.deleteCareProvider(providerID)
        let providers = try await api.careProviders()
        XCTAssertFalse(providers.contains { $0.id == providerID })
    }
}
