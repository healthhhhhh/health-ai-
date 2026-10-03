@testable import HealthMateCore
import XCTest

final class SocialSignInTests: XCTestCase {
    func testOfferedOnlyWhereTheyCanWork() {
        XCTAssertTrue(SocialSignIn.isAvailable(serverIsPreview: true), "Preview mode signs in to the sample account")
        XCTAssertFalse(SocialSignIn.isAvailable(serverIsPreview: false), "a real server can't receive an ID token from the app yet")
    }
}
