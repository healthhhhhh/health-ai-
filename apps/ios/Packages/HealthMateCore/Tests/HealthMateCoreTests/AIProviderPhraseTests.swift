@testable import HealthMateCore
import XCTest

final class AIProviderPhraseTests: XCTestCase {
    func testNamesTheCompanyWhenTheServerReportsIt() {
        XCTAssertEqual("Send files to \(AIProviderPhrase.phrase(recipients: ["Anthropic"])) for a summary.", "Send files to our AI provider, Anthropic, for a summary.")
        XCTAssertEqual(AIProviderPhrase.phrase(recipients: ["Anthropic", "Example AI"]), "our AI providers, Anthropic and Example AI,")
    }

    func testStaysGenericWhenTheServerDoesntSay() {
        XCTAssertEqual(AIProviderPhrase.phrase(recipients: nil), "our AI provider")
        XCTAssertEqual(AIProviderPhrase.phrase(recipients: []), "our AI provider")
        XCTAssertEqual(AIProviderPhrase.phrase(recipients: ["  "]), "our AI provider")
    }

    func testMetaDecodesRecipientsAndToleratesOlderServers() throws {
        let named = try JSONDecoder().decode(APIMeta.self, from: Data(#"{"apiVersion":1,"ai":{"available":true,"recipients":["Anthropic"]}}"#.utf8))
        XCTAssertEqual(named.ai.recipients, ["Anthropic"])
        let older = try JSONDecoder().decode(APIMeta.self, from: Data(#"{"apiVersion":1,"ai":{"available":true}}"#.utf8))
        XCTAssertNil(older.ai.recipients)
    }
}
