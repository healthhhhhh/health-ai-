import Foundation
@testable import HealthMateCore
import XCTest

/// Settings and the restricted-account screen confirm deletion the same way: the password
/// for password accounts, the typed word DELETE for Google / Apple-only accounts.
final class AccountDeletionTests: XCTestCase {
    override func setUp() {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
    }

    private func client() -> APIClient {
        APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
    }

    func testWhichConfirmationEachAccountUses() {
        XCTAssertTrue(AccountDeletion.requiresPassword(signInMethods: ["password"]))
        XCTAssertTrue(AccountDeletion.requiresPassword(signInMethods: ["password", "google"]))
        XCTAssertFalse(AccountDeletion.requiresPassword(signInMethods: ["google"]))
        XCTAssertFalse(AccountDeletion.requiresPassword(signInMethods: ["apple"]))
        // Unknown (e.g. the account couldn't load): ask for the password, which the server always accepts.
        XCTAssertTrue(AccountDeletion.requiresPassword(signInMethods: nil))
    }

    func testOnlyTheExactWordConfirms() {
        XCTAssertTrue(AccountDeletion.isConfirmed("DELETE"))
        XCTAssertTrue(AccountDeletion.isConfirmed("  DELETE "))
        for typed in ["", "delete", "Delete", "DELET", "DELETE!", "yes", "DELETE ME"] {
            XCTAssertFalse(AccountDeletion.isConfirmed(typed), typed)
        }
    }

    func testARestrictedGoogleOnlyAccountCanStillDelete() async throws {
        let api = client()
        _ = try await api.signIn(with: "google")
        let account = try await api.accountSummary()
        XCTAssertFalse(AccountDeletion.requiresPassword(signInMethods: account.signInMethods))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let tenYearsAgo = calendar.date(byAdding: .year, value: -10, to: Date())!
        let result = try await api.assessAge(dateOfBirth: AccountSetupDraft.dayFormatter.string(from: tenYearsAgo))
        XCTAssertEqual(result.eligibility, .ageNotEligible)
        try await api.deleteAccountWithoutPassword()
        let signedIn = await api.isSignedIn
        XCTAssertFalse(signedIn)
    }
}
