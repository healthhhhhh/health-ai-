import Foundation
import XCTest
@testable import HealthMateCore

/// Phase 2C: what AI answers were based on, and the memory lifecycle fields.
final class MemoryContextTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testDescribesWhatAnAnswerUsed() {
        XCTAssertNil(AIBasis.describe(nil))
        XCTAssertNil(AIBasis.describe(AnswerContext(memories: [], usedProfile: false, healthMetrics: [])))
        let memory = AnswerContext.UsedMemory(id: "m", fact: "x", temporalStatus: "current", occurredOn: nil)
        XCTAssertEqual(AIBasis.describe(AnswerContext(memories: [memory], usedProfile: false, healthMetrics: [])), "1 thing from your health memory")
        XCTAssertEqual(
            AIBasis.describe(AnswerContext(memories: [memory, memory], usedProfile: true, healthMetrics: ["sleep", "steps", "resting_heart_rate"])),
            "2 things from your health memory, your health profile and your sleep, steps and resting heart rate data"
        )
        XCTAssertEqual(AIBasis.describe(AnswerContext(memories: [], usedProfile: false, healthMetrics: ["blood_pressure_systolic", "blood_pressure_diastolic"])), "your blood pressure data")
    }

    func testDecodesAnswersWithAndWithoutContext() throws {
        let withContext = try decode(AssistantAnswer.self, """
        {"answer":"Hi","followUp":null,"warningSigns":[],"careRecommendation":null,"memorySuggestions":[],"escalation":null,"notice":null,"safetyAdjusted":false,
         "context":{"memories":[{"id":"m1","fact":"Evening headaches","status":"user_reported","temporalStatus":"current","occurredOn":"2026-06-30"}],"usedProfile":true,"healthMetrics":["sleep"]}}
        """)
        XCTAssertEqual(withContext.context?.memories.first?.fact, "Evening headaches")
        XCTAssertEqual(withContext.context?.healthMetrics, ["sleep"])
        let older = try decode(AssistantAnswer.self, """
        {"answer":"Hi","followUp":null,"warningSigns":[],"careRecommendation":null,"memorySuggestions":[],"escalation":null,"notice":null,"safetyAdjusted":false}
        """)
        XCTAssertNil(older.context)
    }

    func testDecodesMemoryLifecycleFields() throws {
        let memory = try decode(MemoryRecord.self, """
        {"id":"x","fact":"Played football","source":"user_entry","status":"user_reported","createdAt":"2026-09-01T10:00:00.000Z",
         "endedOn":"2018-06-01","temporalStatus":"historical","aiExcluded":true,"lastUsedAt":"2026-09-20T10:00:00.000Z"}
        """)
        XCTAssertTrue(memory.isPast)
        XCTAssertEqual(memory.aiExcluded, true)
        XCTAssertNotNil(memory.lastUsedAt)
    }

    func testPreviewMemoryLifecycleMatchesTheAPI() throws {
        let backend = PreviewBackend()
        let token = try signIn(backend)
        let created = call(backend, "POST", "memories", ["fact": "Walks every morning"], token: token)
        XCTAssertEqual(created.body["temporalStatus"].string, "current")
        XCTAssertEqual(created.body["aiExcluded"].bool, false)
        let id = try XCTUnwrap(created.body["id"].string)
        let excluded = call(backend, "PATCH", "memories/\(id)", ["aiExcluded": true], token: token)
        XCTAssertEqual(excluded.body["aiExcluded"].bool, true)
        XCTAssertEqual(excluded.body["status"].string, "user_reported", "choosing whether the AI uses a fact doesn't confirm it")
        let ended = call(backend, "POST", "memories/\(id)/end", ["endedOn": "2026-01-01"], token: token)
        XCTAssertEqual(ended.body["temporalStatus"].string, "historical")
        XCTAssertEqual(call(backend, "DELETE", "memories", ["confirm": "yes"], token: token).status, 400)
    }

    // MARK: Helpers (the Preview backend's JSON interface)

    private func call(_ backend: PreviewBackend, _ method: String, _ path: String, _ body: JSONValue? = nil, token: String? = nil) -> (status: Int, body: JSONValue) {
        let response = backend.handle(method: method, path: path, body: body?.encoded(), authorization: token.map { "Bearer \($0)" }, state: .normal)
        return (response.status, JSONValue.decode(response.body))
    }

    private func signIn(_ backend: PreviewBackend) throws -> String {
        let res = call(backend, "POST", "auth/login", ["email": "alex.morgan@example.com", "password": "any password", "timeZone": "Europe/London"])
        return try XCTUnwrap(res.body["accessToken"].string)
    }
}
