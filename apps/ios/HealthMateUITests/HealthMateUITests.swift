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

    func testExploreWithoutAnAccountOpensHome() {
        let app = launch(onboarded: false)
        let explore = app.buttons["Explore without an account"]
        XCTAssertTrue(explore.waitForExistence(timeout: 10))
        explore.tap()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 5))
    }

    private func waitUntilEnabled(_ element: XCUIElement) {
        expectation(for: NSPredicate(format: "exists == true AND isEnabled == true AND isHittable == true"), evaluatedWith: element)
        waitForExpectations(timeout: 10)
    }

    /// What's on screen, for failure messages.
    private func screen(_ app: XCUIApplication) -> String {
        let texts = app.staticTexts.allElementsBoundByIndex.map(\.label)
        let buttons = app.buttons.allElementsBoundByIndex.map(\.label)
        return "texts: \(texts.suffix(15).joined(separator: " | ")) — buttons: \(buttons.suffix(15).joined(separator: " | "))"
    }

    /// Preview mode: Get Started → Continue with Apple → account setup → Home, with no server.
    func testSignUpRunsAccountSetupThenOpensHome() {
        let app = launch(onboarded: false, ["-hmPreviewState", "normal"])
        let getStarted = app.buttons["Get Started"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 10), "welcome: \(screen(app))")
        // The welcome actions fade in; tap once they can receive touches.
        expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: getStarted)
        waitForExpectations(timeout: 5)
        getStarted.tap()
        let apple = app.buttons["Continue with Apple"]
        XCTAssertTrue(apple.waitForExistence(timeout: 8), "sign-up sheet: \(screen(app))")
        XCTAssertTrue(app.staticTexts["Create your account"].exists, "sign-up mode: \(screen(app))")
        apple.tap()

        XCTAssertTrue(app.staticTexts["About you"].waitForExistence(timeout: 10), "setup: \(screen(app))")
        // The primary action (Continue / Go to Home) waits until the account's details have loaded.
        let next = app.buttons["setupPrimaryAction"]
        for heading in ["What would help most?", "Your health details", "Your privacy choices", "Reminders", "Apple Health", "You're all set, Alex"] {
            waitUntilEnabled(next)
            next.tap()
            XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 5), "\(heading): \(screen(app))")
        }
        waitUntilEnabled(next)
        XCTAssertEqual(next.label, "Go to Home")
        next.tap()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 10), "home: \(screen(app))")
    }

    /// Preview mode: the bell opens the notification centre, and a notification opens what it's about.
    func testNotificationOpensItsAppointment() {
        let app = launch(["-hmInitialTab", "home", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let bell = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Notifications'")).firstMatch
        XCTAssertTrue(bell.waitForExistence(timeout: 10), "home: \(screen(app))")
        bell.tap()
        XCTAssertTrue(app.navigationBars["Notifications"].waitForExistence(timeout: 5), "notifications: \(screen(app))")
        let checkUp = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Check-up in 3 days'")).firstMatch
        XCTAssertTrue(checkUp.waitForExistence(timeout: 5), "notification row: \(screen(app))")
        checkUp.tap()
        XCTAssertTrue(app.staticTexts["Annual check-up"].waitForExistence(timeout: 5), "appointment: \(screen(app))")
        XCTAssertTrue(app.staticTexts["Bring medication list"].exists)
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

    /// Preview "AI unavailable": the banner explains it, and emergency guidance still appears on-device.
    func testAIUnavailableStillShowsEmergencyGuidance() {
        let app = launch(["-hmInitialTab", "chat", "-hmPreviewState", "ai_unavailable", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        XCTAssertTrue(app.staticTexts["AI answers are unavailable right now"].waitForExistence(timeout: 10), "banner: \(screen(app))")
        let field = messageField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("I have crushing chest pain and can't breathe")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["This could be an emergency"].waitForExistence(timeout: 5), "escalation: \(screen(app))")
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 5), "unavailable row: \(screen(app))")
    }

    /// Health: today's snapshot, 90-day trends, and the daily history down to one day.
    func testHealthDailyHistory() {
        let app = launch(["-hmInitialTab", "health", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 10), "health: \(screen(app))")
        app.buttons["90 days"].tap()
        let history = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Daily health history'")).firstMatch
        for _ in 0..<4 where !history.isHittable { app.swipeUp() }
        history.tap()
        XCTAssertTrue(app.navigationBars["Daily history"].waitForExistence(timeout: 5), "history: \(screen(app))")
        // Row 0 is the Preview notice and row 1 is today (in progress); row 2 is a full day.
        let row = app.cells.element(boundBy: 2)
        XCTAssertTrue(row.waitForExistence(timeout: 5), "rows: \(screen(app))")
        row.tap()
        XCTAssertTrue(app.staticTexts["Resting heart rate"].waitForExistence(timeout: 5), "day: \(screen(app))")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Your usual'")).firstMatch.exists, "usual: \(screen(app))")
    }

    /// The paperclip opens Reports & photos from chat.
    func testAttachOpensReportsFromChat() {
        let app = launch(["-hmInitialTab", "chat", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let attach = app.buttons["Add a report or photo"]
        XCTAssertTrue(attach.waitForExistence(timeout: 10), "chat: \(screen(app))")
        attach.tap()
        app.buttons["Upload a report"].tap()
        XCTAssertTrue(app.navigationBars["Reports & photos"].waitForExistence(timeout: 5), "reports: \(screen(app))")
    }
}
