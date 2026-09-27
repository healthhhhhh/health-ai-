import XCTest
@testable import HealthMateCore

final class PresentationTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_790_000_000)

    func testSleepIsADuration() {
        let p = MetricPresenter.present(HealthMetric(kind: .sleep, value: 432, unit: "min", recordedAt: date, source: .sample, trend: .inUsualRange))
        XCTAssertEqual(p.value, "7h 12m")
        XCTAssertEqual(p.tone, .purple)
    }

    func testStepsShowGoalProgress() {
        let p = MetricPresenter.present(HealthMetric(kind: .steps, value: 6428, unit: "steps", recordedAt: date, source: .sample, trend: .inUsualRange, goal: 10000))
        XCTAssertEqual(p.value, "6,428")
        XCTAssertEqual(p.context, "64% of your goal")
    }

    func testTrendCopyAvoidsClinicalJudgement() {
        for trend in [MetricTrend.inUsualRange, .aboveUsual, .belowUsual, .noBaseline] {
            let label = MetricPresenter.trendLabel(trend).lowercased()
            for word in ["normal", "healthy", "diagnos"] { XCTAssertFalse(label.contains(word), label) }
        }
    }

    func testPlanProgressAndProvenance() {
        let tasks = [
            PlanTask(id: "a", title: "A", category: .medication, scheduledTime: "08:00", completed: true, source: .clinicianProvided),
            PlanTask(id: "b", title: "B", category: .other, scheduledTime: "09:00", completed: false, source: .userReported),
        ]
        XCTAssertEqual(PlanPresenter.progress(tasks), .init(done: 1, total: 2))
        XCTAssertEqual(PlanPresenter.progress([]).ratio, 0)
        XCTAssertEqual(PlanPresenter.sourceLabel(tasks[0]), "From your clinician")
        XCTAssertEqual(PlanPresenter.sourceLabel(tasks[1]), "Added by you")
    }
}

final class SignInValidatorTests: XCTestCase {
    func testRequiresBothFields() {
        XCTAssertEqual(SignInValidator.validate(email: "", password: ""), .init(email: "Enter your email address.", password: "Enter your password."))
    }

    func testRejectsMalformedInput() {
        XCTAssertEqual(SignInValidator.validate(email: "alex@", password: "short"), .init(email: "Enter a valid email address.", password: "Passwords are at least 8 characters."))
    }

    func testAcceptsValidInput() {
        XCTAssertTrue(SignInValidator.validate(email: "alex@example.com", password: "correct horse").isEmpty)
    }
}
