import Foundation
@testable import HealthMateCore
import XCTest

/// The on-device age retry guard: after a restriction, unconfirmed accounts can't try another
/// date of birth on this device for 7 days; confirmed accounts and other devices are unaffected.
final class AgeRetryGuardTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "AgeRetryGuardTests"

    override func setUp() {
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    func testAFreshDeviceLetsAnUnknownAccountAnswer() {
        let guardian = AgeRetryGuard(defaults: defaults)
        XCTAssertFalse(guardian.isActive())
        XCTAssertTrue(guardian.allowsAgeQuestion(for: .ageRequired))
        XCTAssertTrue(guardian.allowsAgeQuestion(for: .eligible))
    }

    func testARestrictionBlocksRetriesButNotConfirmedAccounts() {
        let now = Date()
        let guardian = AgeRetryGuard(defaults: defaults)
        guardian.record(.ageNotEligible, now: now)
        XCTAssertTrue(guardian.isActive(now: now))
        XCTAssertFalse(guardian.allowsAgeQuestion(for: .ageRequired, now: now))
        XCTAssertFalse(guardian.allowsAgeQuestion(for: .ageReview, now: now))
        XCTAssertTrue(guardian.allowsAgeQuestion(for: .eligible, now: now), "accounts the server confirmed aren't affected")
        // A new guard on the same device (e.g. after sign-out and a new account) still blocks.
        XCTAssertFalse(AgeRetryGuard(defaults: defaults).allowsAgeQuestion(for: .ageRequired, now: now))
        // It ends after 7 days.
        XCTAssertTrue(guardian.allowsAgeQuestion(for: .ageRequired, now: now.addingTimeInterval(AgeRetryGuard.duration + 1)))
    }

    func testOnlyRestrictionsArmItAndNoDateIsStored() {
        let guardian = AgeRetryGuard(defaults: defaults)
        guardian.record(.eligible)
        guardian.record(.ageRequired)
        XCTAssertFalse(guardian.isActive())
        guardian.record(.ageReview)
        XCTAssertTrue(guardian.isActive())
        // Only the time of the restriction is kept.
        XCTAssertEqual(Array(defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("hm") }), [AgeRetryGuard.defaultsKey])
        XCTAssertTrue(defaults.object(forKey: AgeRetryGuard.defaultsKey) is Date)
    }
}
