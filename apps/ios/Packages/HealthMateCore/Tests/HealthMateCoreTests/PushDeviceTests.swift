import Foundation
import XCTest
@testable import HealthMateCore

/// Phase 2D: push device records and the sign-in methods an account can have.
final class PushDeviceTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testDecodesRegisteredDevicesWithoutTokens() throws {
        let list = try decode(PushDeviceList.self, """
        {"devices":[{"id":"d1","platform":"ios","environment":"sandbox","appVersion":"1.0 (1)","createdAt":"2026-09-30T10:00:00.000Z","lastRegisteredAt":"2026-09-30T11:00:00.000Z","active":true},
                    {"id":"d2","platform":"ios","environment":"production","appVersion":null,"createdAt":"2026-09-01T10:00:00.000Z","lastRegisteredAt":"2026-09-02T10:00:00.000Z","active":false}]}
        """)
        XCTAssertEqual(list.devices.map(\.id), ["d1", "d2"])
        XCTAssertEqual(list.devices.first?.environment, "sandbox")
        XCTAssertNil(list.devices.last?.appVersion)
        XCTAssertEqual(list.devices.last?.active, false)
    }

    func testDecodesGoogleOnlyAccounts() throws {
        let account = try decode(AccountSummary.self, """
        {"email":"sam@gmail.com","emailVerified":true,"signInMethods":["google"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":false}
        """)
        XCTAssertEqual(account.signInMethods, ["google"])
    }
}
