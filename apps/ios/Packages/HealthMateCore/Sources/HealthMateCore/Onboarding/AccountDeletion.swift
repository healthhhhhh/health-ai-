import Foundation

/// How a person confirms deleting their account. Accounts with a password confirm with it;
/// accounts that sign in with Google or Apple only have no password, so they type DELETE
/// (the API accepts this only for accounts without a password). Shared by Settings and the
/// restricted-account screen.
public enum AccountDeletion {
    public static let confirmationWord = "DELETE"

    /// Whether this account confirms with a password (unknown sign-in methods count as yes,
    /// so nobody is offered a confirmation the server would refuse).
    public static func requiresPassword(signInMethods: [String]?) -> Bool {
        signInMethods?.contains("password") ?? true
    }

    /// The typed confirmation is exactly DELETE (surrounding spaces ignored).
    public static func isConfirmed(_ typed: String) -> Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines) == confirmationWord
    }
}
