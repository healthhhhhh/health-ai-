import Foundation

/// On-device guard against retrying the age question with a different date after the
/// server restricted an account (under 13, or held for review). It keeps only *when* a
/// restriction happened on this device — never a date of birth — and survives sign-out,
/// so a new account on the same device can't simply try again. The server stays the
/// authority: the guard only stops the question being asked; it never unlocks anything,
/// and accounts the server has already confirmed aren't affected.
public struct AgeRetryGuard {
    public static let defaultsKey = "hmAgeRestrictedAt"
    /// How long the guard lasts: 7 days (same as the web).
    public static let duration: TimeInterval = 7 * 24 * 60 * 60

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// A restriction happened on this device within the last 7 days.
    public func isActive(now: Date = Date()) -> Bool {
        guard let at = defaults.object(forKey: Self.defaultsKey) as? Date else { return false }
        return now.timeIntervalSince(at) < Self.duration
    }

    /// Whether an account in this state may submit a date of birth on this device.
    public func allowsAgeQuestion(for eligibility: AgeEligibility, now: Date = Date()) -> Bool {
        eligibility == .eligible || !isActive(now: now)
    }

    /// Remembers that the server restricted an account here (only the time).
    public func record(_ eligibility: AgeEligibility, now: Date = Date()) {
        guard eligibility == .ageReview || eligibility == .ageNotEligible else { return }
        defaults.set(now, forKey: Self.defaultsKey)
    }
}

extension AgeEligibility {
    /// The age-gate refusal in an API error (403 `age_required`, `age_review` or `age_not_eligible`),
    /// or nil for any other error. Lets the app send a restricted account back to setup, like the web.
    public init?(gateError error: Error) {
        guard case APIError.server(let status, let code, _)? = error as? APIError, status == 403,
              let eligibility = AgeEligibility(rawValue: code), eligibility != .eligible, eligibility != .unknown else { return nil }
        self = eligibility
    }
}
