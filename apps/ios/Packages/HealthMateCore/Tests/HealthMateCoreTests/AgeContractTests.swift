import Foundation
import XCTest
@testable import HealthMateCore

/// Age & consent Phase 2A: the account, meta and assessment fields decode from new
/// servers, and older responses (or Preview) without them still decode.
final class AgeContractTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testAccountFromAnOlderServerHasNoAgeFields() throws {
        let account = try decode(AccountSummary.self, """
        {"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true}
        """)
        XCTAssertNil(account.ageBand)
        XCTAssertNil(account.ageStatus)
        XCTAssertNil(account.ageAssessedAt)
    }

    func testAccountWithAgeFields() throws {
        let unknown = try decode(AccountSummary.self, """
        {"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true,
         "ageBand":"unknown","ageStatus":"unknown","ageAssessedAt":null}
        """)
        XCTAssertEqual(unknown.ageBand, .unknown)
        XCTAssertEqual(unknown.ageStatus, .unknown)
        XCTAssertNil(unknown.ageAssessedAt)

        let assessed = try decode(AccountSummary.self, """
        {"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true,
         "ageBand":"16_17","ageStatus":"blocked_out_of_scope","ageAssessedAt":"2026-10-02T12:00:00.000Z"}
        """)
        XCTAssertEqual(assessed.ageBand, .age16to17)
        XCTAssertEqual(assessed.ageStatus, .blockedOutOfScope)
        XCTAssertNotNil(assessed.ageAssessedAt)
    }

    func testUnknownFutureValuesDecodeAsUnknown() throws {
        let account = try decode(AccountSummary.self, """
        {"email":"sam@example.com","emailVerified":true,"signInMethods":[],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true,
         "ageBand":"some_new_band","ageStatus":"some_new_status","ageAssessedAt":"2026-10-02T12:00:00.000Z"}
        """)
        XCTAssertEqual(account.ageBand, .unknown)
        XCTAssertEqual(account.ageStatus, .unknown)
    }

    func testBandAndStatusWireValues() {
        XCTAssertEqual(AgeBand.allCases.map(\.rawValue), ["unknown", "under_13", "13_15", "16_17", "adult"])
        XCTAssertEqual(AgeStatus.allCases.map(\.rawValue), ["unknown", "in_scope", "blocked_under_13", "blocked_out_of_scope", "review"])
    }

    func testMetaWithAndWithoutAge() throws {
        let older = try decode(APIMeta.self, #"{"apiVersion":1,"ai":{"available":true}}"#)
        XCTAssertNil(older.age)
        let current = try decode(APIMeta.self, #"{"apiVersion":1,"ai":{"available":true,"demo":false},"age":{"enforcement":"record","enabledBands":["adult"],"parentalConsent":false}}"#)
        XCTAssertEqual(current.age?.enforcement, "record")
        XCTAssertEqual(current.age?.enabledBands, [.adult])
        XCTAssertEqual(current.age?.parentalConsent, false)
    }

    func testAssessmentResponse() throws {
        let result = try decode(AgeAssessment.self, #"{"ageBand":"13_15","ageStatus":"review","assessedAt":"2026-10-02T12:00:00.000Z","outcome":"review"}"#)
        XCTAssertEqual(result.ageBand, .age13to15)
        XCTAssertEqual(result.ageStatus, .review)
        XCTAssertEqual(result.outcome, "review")
    }

    func testAssessAgeSendsOnlyTheDateOfBirth() async throws {
        StubURLProtocol.reset { _ in .init(status: 200, body: #"{"ageBand":"adult","ageStatus":"in_scope","assessedAt":"2026-10-02T12:00:00.000Z","outcome":"applied"}"#) }
        let tokens = InMemoryTokenStore(SessionTokens(accessToken: "a1", refreshToken: "r1", accessExpiresAt: Date().addingTimeInterval(3600)))
        let client = APIClient(baseURL: URL(string: "https://api.test/v1")!, tokens: tokens, session: StubURLProtocol.session())
        let result = try await client.assessAge(dateOfBirth: "1990-01-01")
        XCTAssertEqual(result.ageBand, .adult)
        let request = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertTrue(request.url!.path.hasSuffix("/me/age"))
    }
}
