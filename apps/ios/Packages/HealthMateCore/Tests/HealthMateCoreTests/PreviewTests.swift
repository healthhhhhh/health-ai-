import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import HealthMateCore

final class SampleAccountTests: XCTestCase {
    func testLoadsTodaysSampleAccountInTheDeviceTimeZone() throws {
        let zone = try XCTUnwrap(TimeZone(identifier: "Asia/Kolkata"))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 15)))
        let account = SampleAccount.load(now: now, timeZone: zone)

        XCTAssertEqual(account["profile"]["profile"]["firstName"].string, "Alex")
        XCTAssertEqual(account["profile"]["profile"]["timeZone"].string, "Asia/Kolkata")
        XCTAssertEqual(account["profile"]["profile"]["dateOfBirth"].string, "1989-06-14", "birthdays are never shifted")
        XCTAssertEqual(account["measurements"]["daily"]["steps"].array.last?["date"].string, "2026-09-29")

        // Times of day are local: the medication reminder is at 08:00 in Kolkata.
        let reminder = try XCTUnwrap(account["notifications"].array.first { $0["category"].string == "medication" })
        let date = try XCTUnwrap(JSONCoding.parseISO8601(reminder["createdAt"].string ?? ""))
        XCTAssertEqual(calendar.component(.hour, from: date), 8)
        XCTAssertEqual(calendar.startOfDay(for: date), calendar.startOfDay(for: now))
    }

    func testClinicalSampleContentStaysGeneric() {
        let account = SampleAccount.load()
        for medication in account["profile"]["medications"].array {
            XCTAssertEqual(medication["instruction"].string, "As prescribed by your clinician")
        }
        for reply in account["replies"].array {
            XCTAssertEqual(reply["answer"]["notice"].string, PreviewBackend.sampleNotice)
        }
    }
}

final class PreviewBackendTests: XCTestCase {
    private var backend: PreviewBackend!

    override func setUp() {
        backend = PreviewBackend()
    }

    private func call(_ method: String, _ path: String, _ body: JSONValue? = nil, token: String? = nil, state: PreviewState = .normal, query: [String: String] = [:]) -> (Int, JSONValue) {
        let response = backend.handle(method: method, path: path, query: query, body: body?.encoded(), authorization: token.map { "Bearer \($0)" }, state: state)
        return (response.status, JSONValue.decode(response.body))
    }

    private func signIn() -> String {
        call("POST", "auth/login", ["email": "alex.morgan@example.com", "password": "any password"]).1["accessToken"].string ?? ""
    }

    func testSignInAndProfile() {
        let token = signIn()
        let (status, me) = call("GET", "me", token: token)
        XCTAssertEqual(status, 200)
        XCTAssertEqual(me["profile"]["firstName"].string, "Alex")
        XCTAssertEqual(call("POST", "auth/login", ["email": "a@b.co", "password": "wrong-password"]).0, 401)
        XCTAssertEqual(call("GET", "me").0, 401)
    }

    func testSignUpVerifiesThroughThePreviewInbox() {
        XCTAssertEqual(call("POST", "auth/register", ["email": "sam@example.com", "password": "long enough", "firstName": "Sam"]).0, 202)
        XCTAssertEqual(call("POST", "auth/login", ["email": "sam@example.com", "password": "long enough"]).1["error"]["code"].string, "email_not_confirmed")
        let email = backend.inbox(for: "sam@example.com").first
        XCTAssertEqual(email?.actionLabel, "Confirm email address")
        let token = email?.action.components(separatedBy: "token=").last ?? ""
        let session = call("POST", "auth/verify-email", ["token": .string(token)]).1["accessToken"].string
        XCTAssertEqual(call("GET", "me/account", token: session).1["onboardingCompleted"].bool, false)
        XCTAssertEqual(call("GET", "me", token: session).1["profile"]["firstName"].string, "Sam")
        XCTAssertEqual(call("POST", "auth/verify-email", ["token": .string(token)]).0, 400, "links work once")
    }

    func testOAuthAndPasswordReset() {
        let oauth = call("POST", "auth/oauth", ["provider": "apple"]).1
        XCTAssertEqual(oauth["isNewUser"].bool, true)
        XCTAssertEqual(call("POST", "auth/password-reset", ["email": "alex.morgan@example.com"]).0, 202)
        let token = backend.inbox(for: "alex.morgan@example.com").first?.action.components(separatedBy: "token=").last ?? ""
        XCTAssertEqual(call("POST", "auth/password-reset/complete", ["accessToken": .string(token), "password": "a new passphrase"]).0, 204)
    }

    func testChatUsesTheSameSafetyOrderAsTheRealGateway() {
        let token = signIn()
        let emergency = call("POST", "conversations", ["message": "I have crushing chest pain and I can't breathe"], token: token).1
        XCTAssertEqual(emergency["messages"].array.last?["payload"]["kind"].string, "escalation")
        XCTAssertEqual(emergency["messages"].array.last?["payload"]["escalation"]["level"].string, "emergency")
        let sleep = call("POST", "conversations", ["message": "How can I sleep better?"], token: token).1
        XCTAssertEqual(sleep["messages"].array.last?["payload"]["notice"].string, PreviewBackend.sampleNotice)
        let medication = call("POST", "conversations", ["message": "Should I stop taking my medication?"], token: token).1
        XCTAssertEqual(medication["messages"].array.last?["payload"]["safetyAdjusted"].bool, true)
    }

    func testDebugStates() {
        let token = signIn()
        XCTAssertEqual(call("GET", "conversations", token: token, state: .empty).1, [])
        XCTAssertEqual(call("GET", "documents", token: token, state: .error).0, 500)
        XCTAssertEqual(call("GET", "me", token: token, state: .error).0, 200, "the app shell still loads")
        XCTAssertTrue(call("GET", "me/consents", token: token, state: .permission).1.array.allSatisfy { $0["granted"].bool == false })
    }

    func testPlanRevisionsAndNotifications() {
        let token = signIn()
        let plan = call("GET", "plan", token: token).1
        XCTAssertEqual(call("PUT", "plan", ["baseRevision": plan["revision"], "items": plan["items"], "completions": []], token: token).0, 200)
        XCTAssertEqual(call("PUT", "plan", ["baseRevision": plan["revision"], "items": [], "completions": []], token: token).0, 409)
        XCTAssertGreaterThan(call("GET", "notifications", token: token).1["unreadCount"].int ?? 0, 0)
        _ = call("POST", "notifications/read-all", token: token)
        XCTAssertEqual(call("GET", "notifications", token: token).1["unreadCount"].int, 0)
    }

    func testUploadedFilesGetASampleResultLater() {
        final class Clock: @unchecked Sendable { var now = Date() }
        let clock = Clock()
        backend = PreviewBackend(now: { clock.now })
        let token = signIn()
        XCTAssertEqual(call("POST", "documents", ["kind": "report", "filename": "x.exe", "contentType": "application/x-msdownload", "byteSize": 10], token: token).0, 415)
        let created = call("POST", "documents", ["kind": "report", "filename": "labs.pdf", "contentType": "application/pdf", "byteSize": 1000], token: token).1
        let id = created["document"]["id"].string ?? ""
        XCTAssertEqual(call("POST", "documents/\(id)/process", token: token).1["status"].string, "processing")
        clock.now = clock.now.addingTimeInterval(5)
        let ready = call("GET", "documents/\(id)", token: token).1
        XCTAssertEqual(ready["status"].string, "ready")
        XCTAssertEqual(ready["result"]["model"].string, "sample", "results are marked as samples")
    }

    func testAnEmergencyPhotoNoteAlwaysGetsEmergencyGuidance() {
        final class Clock: @unchecked Sendable { var now = Date() }
        let clock = Clock()
        backend = PreviewBackend(now: { clock.now })
        let token = signIn()
        var urgency: [String: String] = [:]
        for (label, note) in [("none", nil), ("emergency", "It's spreading fast and I can't breathe")] as [(String, String?)] {
            let created = call("POST", "documents", ["kind": "image", "purpose": "skin", "filename": "arm.jpg", "contentType": "image/jpeg", "byteSize": 1000], token: token).1
            let id = created["document"]["id"].string ?? ""
            _ = call("POST", "documents/\(id)/process", note.map { ["note": .string($0)] }, token: token)
            clock.now = clock.now.addingTimeInterval(5)
            urgency[label] = call("GET", "documents/\(id)", token: token).1["result"]["careUrgency"].string
        }
        XCTAssertEqual(urgency, ["none": "routine", "emergency": "emergency"])
        XCTAssertEqual(PreviewBackend.withNoteTriage(["careUrgency": "emergency"], note: "a bit itchy")["careUrgency"].string, "emergency", "never lowered")
    }

    func testADamagedFileFailsWithAReasonAndANotification() {
        final class Clock: @unchecked Sendable { var now = Date() }
        let clock = Clock()
        backend = PreviewBackend(now: { clock.now })
        let token = signIn()
        let created = call("POST", "documents", ["kind": "report", "filename": "damaged scan.pdf", "contentType": "application/pdf", "byteSize": 1000], token: token).1
        let id = created["document"]["id"].string ?? ""
        _ = call("POST", "documents/\(id)/process", token: token)
        clock.now = clock.now.addingTimeInterval(5)
        let failed = call("GET", "documents/\(id)", token: token).1
        XCTAssertEqual(failed["status"].string, "failed")
        XCTAssertEqual(failed["failureReason"].string, PreviewBackend.failureReason)
        XCTAssertTrue(failed["result"].isNull)
        // Look it up by title: the sample account has notifications dated later today (e.g. 08:56 local), so
        // before then the new one isn't first in the newest-first list.
        let notice = call("GET", "notifications", token: token).1["notifications"].array.first { $0["title"].string == "Couldn't read: damaged scan.pdf" }
        XCTAssertNotNil(notice, "a notification explains the failure")
        XCTAssertEqual(notice?["readAt"].isNull, true)
    }
}

/// The app's own client talking to Preview mode through the URL protocol.
final class PreviewClientTests: XCTestCase {
    override func setUp() {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
    }

    private func client() -> APIClient {
        APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
    }

    func testOriginalFilesDownloadThroughTheSignedLink() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let reports = try await api.documents(kind: .report)
        let report = try XCTUnwrap(reports.first { $0.status == .ready })
        let link = try await api.documentFile(report.id)
        let file = try await api.download(link.url)
        XCTAssertTrue(file.data.starts(with: Array("%PDF".utf8)))
        XCTAssertEqual(file.contentType, "application/pdf")
    }

    func testTheAppClientWorksEndToEndWithoutAServer() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let profile = try await api.healthProfile()
        XCTAssertEqual(profile.profile.firstName, "Alex")
        let conversation = try await api.startConversation("How can I sleep better?")
        XCTAssertFalse(conversation.messages.isEmpty)
        let documents = try await api.documents()
        XCTAssertFalse(documents.isEmpty)
        let submitted = try await api.submitDocument(kind: .report, data: Data("%PDF-1.4".utf8), filename: "labs.pdf", contentType: "application/pdf")
        XCTAssertEqual(submitted.status, .processing)
        let trend = try await api.trend(kind: "steps", days: 7)
        XCTAssertEqual(trend.points.count, 7)
    }

    func testEmailVerificationOAuthAndPasswordResetFromTheApp() async throws {
        let api = client()
        let outcome = try await api.register(email: "robin@example.com", password: "a long password", firstName: "Robin", lastName: "", timeZone: "UTC")
        XCTAssertEqual(outcome, .confirmationRequired)
        let action = try XCTUnwrap(PreviewURLProtocol.backend.inbox(for: "robin@example.com").first?.action)
        _ = try await api.verifyEmail(token: String(action.split(separator: "=").last ?? ""))
        let signedIn = await api.isSignedIn
        XCTAssertTrue(signedIn)
        let profile = try await api.healthProfile()
        XCTAssertEqual(profile.profile.firstName, "Robin")

        _ = try await client().signIn(with: "apple")
        try await api.requestPasswordReset(email: "robin@example.com")
        let reset = try XCTUnwrap(PreviewURLProtocol.backend.inbox(for: "robin@example.com").first?.action)
        try await api.completePasswordReset(token: String(reset.split(separator: "=").last ?? ""), password: "another long one")
    }

    func testOfflineStateSurfacesAsANetworkError() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        PreviewURLProtocol.state = { .offline }
        do {
            _ = try await api.healthProfile()
            XCTFail("expected a network error")
        } catch {
            XCTAssertEqual(error as? APIError, .network)
        }
    }
}

final class SampleHealthSeriesTests: XCTestCase {
    func testServesTheLastDaysOfEachMetric() {
        let series = SampleHealthSeries()
        let steps = series.values(.steps, days: 7)
        XCTAssertEqual(steps.count, 7)
        XCTAssertEqual(steps.last?.date, Calendar.current.startOfDay(for: Date()))
        XCTAssertEqual(series.values(.sleep, days: 30).count, 30)
        XCTAssertTrue(series.values(.weight, days: 7).allSatisfy { $0.value > 40 && $0.value < 150 })
    }
}
