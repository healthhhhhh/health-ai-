import Foundation

/// Mirrors apps/web/src/features/auth/validation.ts.
public enum SignInValidator {
    public struct Errors: Equatable, Sendable {
        public var email: String?
        public var password: String?
        public var isEmpty: Bool { email == nil && password == nil }

        public init(email: String? = nil, password: String? = nil) {
            self.email = email
            self.password = password
        }
    }

    public static func validate(email: String, password: String) -> Errors {
        var errors = Errors()
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            errors.email = "Enter your email address."
        } else if trimmed.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            errors.email = "Enter a valid email address."
        }
        if password.isEmpty {
            errors.password = "Enter your password."
        } else if password.count < 8 {
            errors.password = "Passwords are at least 8 characters."
        }
        return errors
    }
}
