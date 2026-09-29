import XCTest

/// End-to-end UI flows on the simulator. The signed-in test needs the demo
/// API (`npm run demo -w @healthmate/api`) on localhost:4000 and skips otherwise.
final class HealthMateUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(onboarded: Bool = true, _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        // Onboarding tests reset the stored flag instead of pinning it, so finishing onboarding can change it.
        app.launchArguments = (onboarded ? ["-hasCompletedOnboarding", "YES"] : ["-hmResetOnboarding", "YES"]) + extra
        app.launch()
        return app
    }

    /// Dismisses a system permission alert (notifications) if one appears.
    private func dismissSystemAlert() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "Don’t Allow", "Don't Allow"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: 2) {
                button.tap()
                return
            }
        }
    }

    private func messageField(_ app: XCUIApplication) -> XCUIElement {
        let textView = app.textViews["Message"]
        return textView.exists ? textView : app.textFields["Message"]
    }

    func testOnboardingGetStartedOpensHome() {
        let app = launch(onboarded: false)
        let getStarted = app.buttons["Get Started"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 10))
        getStarted.tap()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 5))
    }

    func testEveryTabOpens() {
        let app = launch()
        let tabs = app.tabBars
        XCTAssertTrue(tabs.buttons["Home"].waitForExistence(timeout: 5))

        tabs.buttons["Chat"].tap()
        XCTAssertTrue(app.staticTexts["AI Health Assistant"].waitForExistence(timeout: 5))

        tabs.buttons["Health"].tap()
        XCTAssertTrue(app.navigationBars["Health"].waitForExistence(timeout: 5))

        tabs.buttons["Plans"].tap()
        XCTAssertTrue(app.navigationBars["My Plan"].waitForExistence(timeout: 5))

        tabs.buttons["Profile"].tap()
        XCTAssertTrue(app.navigationBars["Profile"].waitForExistence(timeout: 5))
    }

    func testAddATaskToThePlan() {
        let app = launch(["-hmInitialTab", "plans"])
        let add = app.buttons["Add task"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()

        let title = "UI test walk \(Int.random(in: 1000...9999))"
        let name = app.textFields.element(boundBy: 0)
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText(title)
        app.buttons["Save"].tap()
        dismissSystemAlert()

        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5), "The new task appears in the plan")
    }

    /// Emergency guidance must appear even without an account or network.
    func testEmergencyGuidanceWhenSignedOut() {
        let app = launch(["-hmInitialTab", "chat"])
        let field = messageField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("I have crushing chest pain and can't breathe")
        app.buttons["sendMessage"].tap()

        // Signed out: the sign-in sheet opens; the guidance is already on the chat screen.
        let cancel = app.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 3) { cancel.tap() }
        XCTAssertTrue(app.staticTexts["This could be an emergency"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Call emergency services"].exists)
    }

    func testSignedInChatInPreviewMode() {
        // Preview mode (the Phase 1 default) needs no server: the sample account runs on the device.
        let app = launch(["-hmInitialTab", "chat", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        XCTAssertTrue(app.staticTexts["Preview mode: answers are sample responses, not a real AI and not medical advice."].waitForExistence(timeout: 10))

        let field = messageField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("I get headaches after long days on my laptop")
        app.buttons["sendMessage"].tap()

        let notice = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sample response in Preview mode'")).firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Under an hour"].exists, "Follow-up options are tappable")
    }

}
