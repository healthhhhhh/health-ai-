import Foundation

/// Semantic accent tone; the app target maps it to design-token colours.
public enum Tone: String, Sendable, CaseIterable {
    case blue, green, orange, red, purple, teal
}

/// Display-ready metric: Data → Context → Meaning. Mirrors apps/web/src/lib/metrics.ts.
public struct MetricPresentation: Equatable, Sendable {
    public let label: String
    public let value: String
    public let unit: String?
    public let context: String?
    public let tone: Tone
}

public enum MetricPresenter {
    /// Plain-language comparison to the user's own baseline. Never "normal"/"healthy".
    public static func trendLabel(_ trend: MetricTrend) -> String {
        switch trend {
        case .inUsualRange: return "In your usual range"
        case .aboveUsual: return "Higher than your usual"
        case .belowUsual: return "Lower than your usual"
        case .noBaseline: return "Building your baseline"
        }
    }

    public static func label(for kind: MetricKind) -> String {
        switch kind {
        case .heartRate: return "Heart Rate"
        case .steps: return "Steps"
        case .sleep: return "Sleep"
        case .calories: return "Calories"
        case .water: return "Water"
        case .weight: return "Weight"
        case .bloodPressure: return "Blood Pressure"
        }
    }

    public static func tone(for kind: MetricKind) -> Tone {
        switch kind {
        case .heartRate: return .red
        case .steps: return .green
        case .sleep: return .purple
        case .calories: return .orange
        case .water, .bloodPressure: return .blue
        case .weight: return .teal
        }
    }

    public static func present(_ metric: HealthMetric) -> MetricPresentation {
        let label = label(for: metric.kind)
        let tone = tone(for: metric.kind)
        let goalContext = metric.goal.flatMap { $0 > 0 ? "\(Int((metric.value / $0 * 100).rounded()))% of your goal" : nil }
        switch metric.kind {
        case .sleep:
            return MetricPresentation(label: label, value: HealthFormat.duration(minutes: metric.value), unit: nil, context: trendLabel(metric.trend), tone: tone)
        case .steps:
            return MetricPresentation(label: label, value: HealthFormat.number(metric.value), unit: nil, context: goalContext ?? trendLabel(metric.trend), tone: tone)
        case .water:
            let value = metric.goal.map { "\(HealthFormat.number(metric.value)) / \(HealthFormat.number($0))" } ?? HealthFormat.number(metric.value)
            return MetricPresentation(label: label, value: value, unit: metric.unit, context: goalContext, tone: tone)
        case .calories:
            return MetricPresentation(label: label, value: HealthFormat.number(metric.value), unit: metric.unit, context: "Active energy today", tone: tone)
        default:
            return MetricPresentation(label: label, value: HealthFormat.number(metric.value), unit: metric.unit, context: trendLabel(metric.trend), tone: tone)
        }
    }
}

public enum PlanPresenter {
    public struct Progress: Equatable, Sendable {
        public let done: Int
        public let total: Int
        public var ratio: Double { total == 0 ? 0 : Double(done) / Double(total) }
    }

    public static func progress(_ tasks: [PlanTask]) -> Progress {
        Progress(done: tasks.filter(\.completed).count, total: tasks.count)
    }

    /// Provenance shown beside a task — medication tasks always say where the instruction came from.
    public static func sourceLabel(_ task: PlanTask) -> String? {
        switch task.source {
        case .clinicianProvided: return "From your clinician"
        case .userReported: return "Added by you"
        case .sample: return task.category == .medication ? "Sample task" : nil
        default: return nil
        }
    }
}

public enum MoodPresenter {
    public static func label(_ mood: Mood) -> String { mood.rawValue.capitalized }

    public static func followUp(_ mood: Mood) -> String {
        switch mood {
        case .great: return "Glad to hear it! Keep it up."
        case .good: return "Nice. Your check-in has been saved."
        case .okay: return "Thanks for checking in."
        case .low: return "Sorry you're feeling low. Want to talk it through?"
        case .unwell: return "Sorry you're unwell. Tell the assistant what's going on — if symptoms are severe, contact a doctor or emergency services."
        }
    }
}
