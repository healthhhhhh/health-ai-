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

    /// Plan: Medications shows the instruction word for word, and an item opens its detail with its history.
    func testPlanMedicationsAndItemDetail() {
        let app = launch(["-hmInitialTab", "plans"])
        let medications = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Plan and profile'")).firstMatch
        XCTAssertTrue(medications.waitForExistence(timeout: 8), "plan: \(screen(app))")
        medications.tap()
        XCTAssertTrue(app.navigationBars["Medications"].waitForExistence(timeout: 5), "medications: \(screen(app))")
        XCTAssertTrue(app.staticTexts["Instructions, exactly as entered"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts["As prescribed · after breakfast"].exists, "verbatim: \(screen(app))")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // SwiftUI can expose a navigation link more than once in the accessibility tree.
        let details = app.buttons["Morning medication details"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 5), "row: \(screen(app))")
        details.tap()
        XCTAssertTrue(app.staticTexts["Last 7 days"].waitForExistence(timeout: 5), "detail: \(screen(app))")
        XCTAssertTrue(app.buttons["Remove"].exists)
    }

    /// Care: the hub puts emergency help first, and an appointment's questions checklist saves.
    func testCareHubAndAppointmentQuestions() {
        let app = launch(["-hmInitialTab", "profile", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let care = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Care: appointments and care team'")).firstMatch
        for _ in 0..<6 where !care.isHittable { app.swipeUp() }
        XCTAssertTrue(care.waitForExistence(timeout: 10), "profile: \(screen(app))")
        care.tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'In an emergency, call'")).firstMatch.waitForExistence(timeout: 8), "care: \(screen(app))")
        let checkUp = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Annual check-up'")).firstMatch
        XCTAssertTrue(checkUp.waitForExistence(timeout: 8), "appointments: \(screen(app))")
        checkUp.tap()
        let suggestion = app.buttons["What should I expect from this visit?"]
        for _ in 0..<4 where !suggestion.isHittable { app.swipeUp() }
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5), "checklist: \(screen(app))")
        suggestion.tap()
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 5), "saved: \(screen(app))")
    }

    /// Settings: reachable from Profile, with notifications, display, privacy, data and account.
    func testSettingsSections() {
        let app = launch(["-hmInitialTab", "profile", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let gear = app.navigationBars["Profile"].buttons["Settings"]
        XCTAssertTrue(gear.waitForExistence(timeout: 10), "profile: \(screen(app))")
        gear.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "settings: \(screen(app))")
        XCTAssertTrue(app.buttons["Notifications"].exists)
        XCTAssertTrue(app.switches.containing(NSPredicate(format: "label CONTAINS 'AI Health Assistant'")).firstMatch.exists, "privacy: \(screen(app))")
        app.buttons["Notifications"].tap()
        XCTAssertTrue(app.switches.containing(NSPredicate(format: "label CONTAINS 'Medication reminders'")).firstMatch.waitForExistence(timeout: 8), "notifications: \(screen(app))")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let account = app.buttons["Account & password"]
        for _ in 0..<4 where !account.isHittable { app.swipeUp() }
        account.tap()
        // LabeledContent combines its label and value ("Email, alex.morgan@example.com").
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'alex.morgan@example.com'")).firstMatch.waitForExistence(timeout: 8), "account: \(screen(app))")
    }

    /// Largest accessibility text size in dark mode: every tab still loads its main content.
    func testLargestTextInDarkMode() {
        let app = launch(["-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password",
                          "-hmAppearance", "dark", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let tabs = app.tabBars
        XCTAssertTrue(tabs.buttons["Home"].waitForExistence(timeout: 10), "home: \(screen(app))")
        tabs.buttons["Chat"].tap()
        XCTAssertTrue(messageField(app).waitForExistence(timeout: 8), "chat: \(screen(app))")
        tabs.buttons["Health"].tap()
        XCTAssertTrue(app.navigationBars["Health"].waitForExistence(timeout: 8), "health: \(screen(app))")
        tabs.buttons["Plans"].tap()
        XCTAssertTrue(app.navigationBars["My Plan"].waitForExistence(timeout: 8), "plan: \(screen(app))")
        tabs.buttons["Profile"].tap()
        XCTAssertTrue(app.navigationBars["Profile"].waitForExistence(timeout: 8), "profile: \(screen(app))")
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

    /// Timeline: a filter narrows the list, and an entry opens with its details and edit actions.
    func testTimelineFilterOpensEntry() {
        let app = launch(["-hmInitialTab", "health", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 10), "health: \(screen(app))")
        let timeline = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Health timeline'")).firstMatch
        for _ in 0..<5 where !timeline.isHittable { app.swipeUp() }
        timeline.tap()
        XCTAssertTrue(app.navigationBars["Timeline"].waitForExistence(timeout: 5), "timeline: \(screen(app))")
        let symptoms = app.buttons["Symptoms"]
        XCTAssertTrue(symptoms.waitForExistence(timeout: 5), "filters: \(screen(app))")
        symptoms.tap()
        let headache = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Headache'")).firstMatch
        XCTAssertTrue(headache.waitForExistence(timeout: 5), "symptoms: \(screen(app))")
        headache.tap()
        XCTAssertTrue(app.navigationBars["Entry"].waitForExistence(timeout: 5), "entry: \(screen(app))")
        XCTAssertTrue(app.buttons["Edit entry"].exists, "edit: \(screen(app))")
    }

    /// Reports: filters narrow the list, and a report opens with its labelled sample summary and questions.
    func testReportsFilterAndSampleResult() {
        let app = launch(["-hmInitialTab", "chat", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let attach = app.buttons["Add a report or photo"]
        XCTAssertTrue(attach.waitForExistence(timeout: 10), "chat: \(screen(app))")
        attach.tap()
        app.buttons["Upload a report"].tap()
        XCTAssertTrue(app.navigationBars["Reports & photos"].waitForExistence(timeout: 5), "reports: \(screen(app))")
        let labs = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Lab results'")).firstMatch
        XCTAssertTrue(labs.waitForExistence(timeout: 5), "rows: \(screen(app))")
        app.buttons["Photos"].tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS 'Skin or rash'")).firstMatch.waitForExistence(timeout: 5), "photos: \(screen(app))")
        XCTAssertFalse(labs.exists, "reports are filtered out")
        app.buttons["All"].tap()
        XCTAssertTrue(labs.waitForExistence(timeout: 5))
        labs.tap()
        XCTAssertTrue(app.staticTexts["Sample result in Preview mode — this file wasn't analysed and nothing here is about you."].waitForExistence(timeout: 5), "detail: \(screen(app))")
        let questions = app.staticTexts["Questions to ask your doctor"]
        for _ in 0..<5 where !questions.isHittable { app.swipeUp() }
        XCTAssertTrue(questions.exists, "questions: \(screen(app))")
        XCTAssertTrue(app.buttons["Ask the AI Health Assistant"].exists, "ask: \(screen(app))")
    }

    /// Photo check: chat's "Check a photo" opens the guided flow, with the emergency advice first.
    func testPhotoCheckGuidesThePhoto() {
        let app = launch(["-hmInitialTab", "chat", "-hmPreviewState", "normal", "-hmDemoEmail", "alex.morgan@example.com", "-hmDemoPassword", "preview-password"])
        let attach = app.buttons["Add a report or photo"]
        XCTAssertTrue(attach.waitForExistence(timeout: 10), "chat: \(screen(app))")
        attach.tap()
        app.buttons["Check a photo"].tap()
        XCTAssertTrue(app.navigationBars["Photo check"].waitForExistence(timeout: 12), "photo check: \(screen(app))")
        XCTAssertTrue(app.staticTexts["What does the photo show?"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'call your local emergency number now'")).firstMatch.exists, "advice: \(screen(app))")
        let next = app.buttons["Continue"]
        XCTAssertFalse(next.isEnabled, "a purpose comes first")
        app.buttons.containing(NSPredicate(format: "label CONTAINS 'Skin or rash'")).firstMatch.tap()
        next.tap()
        XCTAssertTrue(app.staticTexts["Take a clear photo"].waitForExistence(timeout: 5), "take: \(screen(app))")
        XCTAssertTrue(app.staticTexts["Show the whole rash or spot, not just part of it."].exists, "tips: \(screen(app))")
        XCTAssertTrue(app.buttons["Choose a photo"].exists)
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
