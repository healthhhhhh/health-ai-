import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import HealthMateCore

/// Serves canned responses by path; records requests.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Response { let status: Int; let body: String }
    nonisolated(unsafe) static var handler: ((URLRequest) -> Response)?
    nonisolated(unsafe) static var requests: [URLRequest] = []
    private static let lock = NSLock()

    static func reset(_ handler: @escaping (URLRequest) -> Response) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
        requests = []
    }

    static var recorded: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let handler = Self.handler
        Self.lock.unlock()
        let response = handler?(request) ?? Response(status: 500, body: "{}")
        let http = HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(response.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

final class APIClientTests: XCTestCase {
    private let base = URL(string: "https://api.test/v1")!
    private let far = Date().addingTimeInterval(3600)

    func testSendsBearerTokenAndDecodes() async throws {
        StubURLProtocol.reset { _ in .init(status: 200, body: #"{"apiVersion":1,"ai":{"available":true}}"#) }
        let client = APIClient(baseURL: base, tokens: InMemoryTokenStore(SessionTokens(accessToken: "a1", refreshToken: "r1", accessExpiresAt: far)), session: StubURLProtocol.session())
        let consents: APIMeta = try await client.send(Endpoint("GET", "meta"))
        XCTAssertTrue(consents.ai.available)
        XCTAssertEqual(StubURLProtocol.recorded.first?.value(forHTTPHeaderField: "Authorization"), "Bearer a1")
    }

    func testRefreshesOnceOn401ThenRetries() async throws {
        StubURLProtocol.reset { request in
            if request.url!.path.hasSuffix("auth/refresh") {
                return .init(status: 200, body: #"{"accessToken":"a2","refreshToken":"r2","expiresIn":900}"#)
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer a2" {
                return .init(status: 200, body: "[]")
            }
            return .init(status: 401, body: #"{"error":{"code":"unauthorized","message":"Expired"}}"#)
        }
        let store = InMemoryTokenStore(SessionTokens(accessToken: "a1", refreshToken: "r1", accessExpiresAt: far))
        let client = APIClient(baseURL: base, tokens: store, session: StubURLProtocol.session())
        let conversations = try await client.conversations()
        XCTAssertEqual(conversations, [])
        let saved = await store.load()
        XCTAssertEqual(saved?.accessToken, "a2")
        XCTAssertEqual(saved?.refreshToken, "r2")
        XCTAssertEqual(StubURLProtocol.recorded.filter { $0.url!.path.hasSuffix("auth/refresh") }.count, 1)
    }

    func testFailedRefreshClearsSession() async {
        StubURLProtocol.reset { _ in .init(status: 401, body: #"{"error":{"code":"unauthorized","message":"Expired"}}"#) }
        let store = InMemoryTokenStore(SessionTokens(accessToken: "a1", refreshToken: "r1", accessExpiresAt: far))
        let client = APIClient(baseURL: base, tokens: store, session: StubURLProtocol.session())
        do {
            _ = try await client.conversations()
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        let saved = await store.load()
        XCTAssertNil(saved)
    }

    func testNoTokensMeansUnauthorizedWithoutNetwork() async {
        StubURLProtocol.reset { _ in .init(status: 200, body: "[]") }
        let client = APIClient(baseURL: base, tokens: InMemoryTokenStore(), session: StubURLProtocol.session())
        do {
            _ = try await client.conversations()
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        XCTAssertTrue(StubURLProtocol.recorded.isEmpty)
    }

    func testMapsAIUnavailableErrors() {
        let data = Data(#"{"error":{"code":"ai_unavailable","message":"The AI Health Assistant is unavailable right now."}}"#.utf8)
        XCTAssertEqual(APIClient.mapError(status: 503, data: data), .aiUnavailable("The AI Health Assistant is unavailable right now."))
        XCTAssertEqual(APIClient.mapError(status: 500, data: Data("oops".utf8)), .server(status: 500, code: "unknown", message: "Something went wrong. Please try again."))
    }

    func testDecodesAssistantPayloads() throws {
        let escalation = #"""
        {"id":"m1","role":"assistant","content":"x","triageLevel":"emergency","createdAt":"2026-09-28T10:00:00.000Z",
         "payload":{"kind":"escalation","escalation":{"level":"emergency","title":"This could be an emergency","body":"Call now.","actions":[{"kind":"call_emergency","label":"Call emergency services"}]}}}
        """#
        let message = try JSONCoding.makeDecoder().decode(ChatMessageRecord.self, from: Data(escalation.utf8))
        guard case .escalation(let e) = message.payload else { return XCTFail("Expected escalation") }
        XCTAssertEqual(e.actions.first?.kind, .callEmergency)

        let answer = #"""
        {"id":"m2","role":"assistant","content":"x","triageLevel":"routine","createdAt":"2026-09-28T10:00:00Z",
         "payload":{"kind":"answer","answer":"Rest and fluids may help.","followUp":{"question":"How severe is it?","options":["Mild","Moderate","Severe"],"allowsMultiple":false},
         "warningSigns":["Stiff neck"],"careRecommendation":null,"memorySuggestions":[{"fact":"Gets migraines"}],"escalation":null,"notice":null,"safetyAdjusted":false}}
        """#
        let decoded = try JSONCoding.makeDecoder().decode(ChatMessageRecord.self, from: Data(answer.utf8))
        guard case .answer(let a) = decoded.payload else { return XCTFail("Expected answer") }
        XCTAssertEqual(a.followUp?.options, ["Mild", "Moderate", "Severe"])
        XCTAssertEqual(a.memorySuggestions.first?.fact, "Gets migraines")
    }

    func testMedicationInstructionIsSentVerbatim() async throws {
        StubURLProtocol.reset { _ in .init(status: 201, body: #"{"id":"x"}"#) }
        let client = APIClient(baseURL: base, tokens: InMemoryTokenStore(SessionTokens(accessToken: "a1", refreshToken: "r1", accessExpiresAt: far)), session: StubURLProtocol.session())
        let instruction = "Take 1 tablet (500 mg) twice daily — with food; skip if fasting per Dr."
        try await client.addMedication(name: "Metformin", instruction: instruction, source: .clinicianProvided)
        let request = try XCTUnwrap(StubURLProtocol.recorded.first)
        let body = try XCTUnwrap(request.httpBody ?? request.httpBodyStream.map(Self.read))
        let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(json?["instruction"] as? String, instruction)
        XCTAssertEqual(json?["source"] as? String, "clinician_provided")
    }

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
