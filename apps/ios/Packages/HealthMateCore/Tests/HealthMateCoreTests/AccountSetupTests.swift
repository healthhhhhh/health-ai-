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

    private func day(_ value: String) -> Date { AccountSetupDraft.dayFormatter.date(from: value)! }

    /// A date of birth `years` ago (UTC), shifted by `days`.
    private func yearsAgo(_ years: Int, days: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let start = calendar.date(byAdding: .year, value: -years, to: calendar.startOfDay(for: Date()))!
        return calendar.date(byAdding: .day, value: days, to: start)!
    }

    func testGoalIdsMatchTheWebApp() {
        XCTAssertEqual(HealthGoal.all.map(\.id), ["understand_reports", "track_symptoms", "manage_medications", "sleep_better", "be_active", "prepare_appointments"])
    }

    func testStepsSkipTheImportWhenAppleHealthIsntConnected() {
        XCTAssertEqual(AccountSetupStep.countedSteps, 4)
        XCTAssertEqual(AccountSetupStep.welcome.next(importsHealth: false), .appleHealth)
        XCTAssertEqual(AccountSetupStep.appleHealth.next(importsHealth: false), .about)
        XCTAssertEqual(AccountSetupStep.privacy.next(importsHealth: false), .done)
        XCTAssertEqual(AccountSetupStep.privacy.next(importsHealth: true), .importHealth)
        XCTAssertEqual(AccountSetupStep.importHealth.next(importsHealth: true), .done)
        XCTAssertNil(AccountSetupStep.done.next(importsHealth: true))
        XCTAssertTrue(AccountSetupStep.appleHealth.isOptional)
        XCTAssertTrue(AccountSetupStep.importHealth.isOptional)
        XCTAssertFalse(AccountSetupStep.about.isOptional)
        // The profile is saved once privacy choices are done, so there's no going back from the import.
        XCTAssertNil(AccountSetupStep.importHealth.previous)
        XCTAssertEqual(AccountSetupStep.privacy.previous, .about)
    }

    func testNameAndDateOfBirthAreRequired() {
        var draft = AccountSetupDraft()
        XCTAssertEqual(draft.problem(at: .about), "Enter your first name.")
        draft.firstName = "Robin"
        XCTAssertEqual(draft.problem(at: .about), "Enter your date of birth.")
        draft.setDateOfBirth(Date().addingTimeInterval(86_400 * 3))
        XCTAssertEqual(draft.problem(at: .about), "Your date of birth can't be in the future.")
        draft.setDateOfBirth(day("1990-04-12"))
        XCTAssertNil(draft.problem(at: .about))
        XCTAssertEqual(draft.dateOfBirthDay, "1990-04-12")
        // Other steps have nothing required, and consents start off unless already granted.
        XCTAssertNil(draft.problem(at: .privacy))
        XCTAssertEqual(draft.grantedConsentCount, 0)
    }

    func testAnAppleHealthDateOfBirthOnlyPrefillsAndMustBeConfirmed() {
        var draft = AccountSetupDraft()
        draft.firstName = "Robin"
        draft.prefillDateOfBirth(fromAppleHealth: DateComponents(year: 1990, month: 4, day: 12))
        XCTAssertEqual(draft.dateOfBirthSource, .appleHealth)
        XCTAssertEqual(draft.dateOfBirthDay, "1990-04-12")
        XCTAssertEqual(draft.problem(at: .about), "Check that the date of birth from Apple Health is right, then confirm it.")
        draft.dateOfBirthConfirmed = true
        XCTAssertNil(draft.problem(at: .about))

        // Changing it makes it the person's own answer.
        draft.setDateOfBirth(day("1991-05-01"))
        XCTAssertEqual(draft.dateOfBirthSource, .person)
        XCTAssertNil(draft.problem(at: .about))

        // Never overrides a date already entered, and an incomplete value is ignored.
        draft.prefillDateOfBirth(fromAppleHealth: DateComponents(year: 1980, month: 1, day: 1))
        XCTAssertEqual(draft.dateOfBirthDay, "1991-05-01")
        var empty = AccountSetupDraft()
        empty.prefillDateOfBirth(fromAppleHealth: DateComponents(year: 1990))
        empty.prefillDateOfBirth(fromAppleHealth: nil)
        XCTAssertNil(empty.dateOfBirth, "no date of birth in Apple Health: the person enters it")
    }

    func testTheNameComesFromTheAccountBeforeTheAgeCheck() async throws {
        let api = client()
        _ = try await api.signIn(with: "google")
        let account = try await api.accountSummary()
        let draft = AccountSetupDraft(account: account)
        XCTAssertEqual(draft.firstName, account.firstName)
        XCTAssertFalse(draft.firstName.isEmpty)
    }

    func testANewAccountConfirmsItsAgeThenSavesItsChoices() async throws {
        let api = client()
        _ = try await api.signIn(with: "google")
        let before = try await api.accountSummary()
        XCTAssertFalse(before.onboardingCompleted)
        let consents = try await api.consents()
        XCTAssertTrue(consents.allSatisfy { !$0.granted }, "a new account starts with every consent off")

        var draft = AccountSetupDraft(account: before)
        draft.firstName = "Sam"
        draft.setDateOfBirth(yearsAgo(16))
        let eligibility = try await draft.confirmAge(using: api)
        XCTAssertEqual(eligibility, .eligible)
        draft.consents["ai_processing"] = true
        draft.consents["health_data_sync"] = true
        try await draft.save(using: api, timeZone: "UTC")
        try await AccountSetupDraft.finish(using: api)

        let after = try await api.accountSummary()
        XCTAssertTrue(after.onboardingCompleted)
        XCTAssertEqual(after.ageEligibility, .eligible)
        let saved = try await api.healthProfile()
        XCTAssertEqual(saved.profile.firstName, "Sam")
        XCTAssertEqual(saved.profile.dateOfBirth, draft.dateOfBirthDay)
        let granted = try await api.consents().filter(\.granted).map(\.kind).sorted()
        XCTAssertEqual(granted, ["ai_processing", "health_data_sync"])
    }

    func testUnder13CantContinueAndHealthDataStaysLocked() async throws {
        let api = client()
        _ = try await api.signIn(with: "google")
        let account = try await api.accountSummary()
        var draft = AccountSetupDraft(account: account)
        draft.firstName = "Kit"
        draft.setDateOfBirth(yearsAgo(13, days: 1))
        let first = try await draft.confirmAge(using: api)
        XCTAssertEqual(first, .ageNotEligible)
        // Health features are refused; account controls still work.
        do {
            _ = try await api.healthProfile()
            XCTFail("a restricted account can't read health data")
        } catch APIError.server(let status, let code, _) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(code, "age_not_eligible")
        }
        let summary = try await api.accountSummary()
        XCTAssertEqual(summary.ageEligibility, .ageNotEligible)
        XCTAssertNotNil(summary.ageDeletionScheduledAt)
        // Entering an adult date afterwards doesn't unlock it.
        draft.setDateOfBirth(yearsAgo(30))
        let retry = try await draft.confirmAge(using: api)
        XCTAssertEqual(retry, .ageReview)
    }

    func testTheSampleAccountHasAlreadyFinishedSetup() async throws {
        let api = client()
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        let summary = try await api.accountSummary()
        XCTAssertTrue(summary.onboardingCompleted)
    }
}
