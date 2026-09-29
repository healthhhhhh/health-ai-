import Foundation
@testable import HealthMateCore
import XCTest

final class AccountSetupTests: XCTestCase {
    override func setUp() {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { .normal }
    }

    private func client() -> APIClient {
        APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
    }

    func testGoalIdsMatchTheWebApp() {
        XCTAssertEqual(HealthGoal.all.map(\.id), ["understand_reports", "track_symptoms", "manage_medications", "sleep_better", "be_active", "prepare_appointments"])
    }

    func testStepsAndValidation() {
        XCTAssertEqual(AccountSetupStep.countedSteps, 6)
        XCTAssertEqual(AccountSetupStep.about.next, .goals)
        XCTAssertNil(AccountSetupStep.done.next)
        XCTAssertTrue(AccountSetupStep.health.isOptional)
        XCTAssertFalse(AccountSetupStep.privacy.isOptional)

        var draft = AccountSetupDraft()
        XCTAssertEqual(draft.problem(at: .about), "Enter your first name.")
        draft.firstName = "Robin"
        XCTAssertNil(draft.problem(at: .about))
        draft.dateOfBirth = Date().addingTimeInterval(86_400 * 3)
        XCTAssertEqual(draft.problem(at: .about), "Your date of birth can't be in the future.")
        draft.medications = [.init(name: "Morning medication", instruction: "  ")]
        XCTAssertNotNil(draft.problem(at: .health))
        // Consents start off unless already granted.
        XCTAssertEqual(draft.grantedConsentCount, 0)
    }

    func testANewAccountIsSentThroughSetupAndSavesEverything() async throws {
        let api = client()
        _ = try await api.signIn(with: "google")
        let before = try await api.accountSummary()
        XCTAssertFalse(before.onboardingCompleted)
        let consents = try await api.consents()
        XCTAssertTrue(consents.allSatisfy { !$0.granted }, "a new account starts with every consent off")
        let profile = try await api.healthProfile()
        XCTAssertEqual(profile.profile.goals ?? [], [])

        var draft = AccountSetupDraft(profile: profile.profile)
        draft.firstName = "Sam"
        draft.goals = ["sleep_better", "not_a_goal"]
        draft.conditions = ["Example condition"]
        draft.medications = [.init(name: "Morning medication", instruction: "  As prescribed by your clinician  ")]
        draft.consents["ai_processing"] = true
        draft.reminders.task = false
        try await draft.save(using: api, timeZone: "UTC")

        let after = try await api.accountSummary()
        XCTAssertTrue(after.onboardingCompleted)
        let saved = try await api.healthProfile()
        XCTAssertEqual(saved.profile.firstName, "Sam")
        XCTAssertEqual(saved.profile.goals, ["sleep_better"])
        let medication = try XCTUnwrap(saved.medications.last)
        XCTAssertEqual(medication.instruction, "As prescribed by your clinician")
        XCTAssertEqual(medication.source, .userReported)
        XCTAssertEqual(saved.conditions.last?.source, .userReported)
        let granted = try await api.consents().filter(\.granted).map(\.kind)
        XCTAssertEqual(granted, ["ai_processing"])
        let preferences = try await api.notificationPreferences()
        XCTAssertFalse(preferences.task)
        XCTAssertTrue(preferences.medication)
    }

    func testTheSampleAccountHasAlreadyFinishedSetup() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let summary = try await api.accountSummary()
        XCTAssertTrue(summary.onboardingCompleted)
    }
}
