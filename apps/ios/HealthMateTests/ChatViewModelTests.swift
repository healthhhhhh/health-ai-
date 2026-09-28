import HealthMateCore
import XCTest
@testable import HealthMate

/// Canned HTTP responses for view-model tests.
private final class ChatStubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var respond: ((URLRequest) -> (Int, String))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let (status, body) = Self.respond?(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class ChatViewModelTests: XCTestCase {
    private func makeModel() -> ChatViewModel {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ChatStubProtocol.self]
        let tokens = InMemoryTokenStore(SessionTokens(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(3600)))
        let api = APIClient(baseURL: URL(string: "https://api.test/v1")!, tokens: tokens, session: URLSession(configuration: config))
        return ChatViewModel(api: api)
    }

    override func tearDown() {
        ChatStubProtocol.respond = nil
        super.tearDown()
    }

    func testEmergencyGuidanceAppearsEvenWhenOffline() async {
        ChatStubProtocol.respond = nil // network down
        let model = makeModel()
        await model.send("I have crushing chest pain and I can't breathe")
        XCTAssertTrue(model.items.contains { if case .localEscalation(_, let e) = $0 { return e.level == .emergency }; return false })
        XCTAssertNotNil(model.errorMessage)
        XCTAssertEqual(model.failedText, "I have crushing chest pain and I can't breathe")
    }

    func testCrisisMessageShowsCrisisSupport() async {
        let model = makeModel()
        await model.send("I want to kill myself")
        let escalation = model.items.compactMap { item -> Escalation? in
            if case .localEscalation(_, let e) = item { return e }
            return nil
        }.first
        XCTAssertEqual(escalation?.actions.map(\.kind), [.callEmergency, .crisisSupport])
    }

    func testRoutineMessageHasNoLocalEscalation() async {
        ChatStubProtocol.respond = { _ in
            (201, #"""
            {"conversation":{"id":"c1","title":"Headache","createdAt":"2026-09-28T10:00:00Z","updatedAt":"2026-09-28T10:00:00Z"},
             "messages":[{"id":"u1","role":"user","content":"I have a mild headache","payload":null,"triageLevel":"routine","createdAt":"2026-09-28T10:00:00Z"},
                         {"id":"m1","role":"assistant","content":"Sorry to hear that.","triageLevel":"routine","createdAt":"2026-09-28T10:00:01Z",
                          "payload":{"kind":"answer","answer":"Sorry to hear that.","followUp":null,"warningSigns":[],"careRecommendation":null,"memorySuggestions":[],"escalation":null,"notice":null,"safetyAdjusted":false}}]}
            """#)
        }
        let model = makeModel()
        await model.send("I have a mild headache")
        XCTAssertFalse(model.items.contains { if case .localEscalation = $0 { return true }; return false })
        XCTAssertEqual(model.items.count, 2)
        XCTAssertNil(model.errorMessage)
    }

    func testServerEscalationReplacesLocalOne() async {
        ChatStubProtocol.respond = { _ in
            (201, #"""
            {"conversation":{"id":"c1","title":"Chest pain","createdAt":"2026-09-28T10:00:00Z","updatedAt":"2026-09-28T10:00:00Z"},
             "messages":[{"id":"m1","role":"assistant","content":"x","triageLevel":"emergency","createdAt":"2026-09-28T10:00:01Z",
                          "payload":{"kind":"escalation","escalation":{"level":"emergency","title":"This could be an emergency","body":"Call now.","actions":[{"kind":"call_emergency","label":"Call emergency services"}]}}}]}
            """#)
        }
        let model = makeModel()
        await model.send("crushing chest pain and short of breath")
        let escalations = model.items.filter {
            switch $0 {
            case .localEscalation: return true
            case .assistant(let m): if case .escalation = m.payload { return true }; return false
            case .user: return false
            }
        }
        XCTAssertEqual(escalations.count, 1, "Emergency guidance should appear once, not twice")
    }
}
