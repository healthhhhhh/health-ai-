import Foundation

/// Metrics shown on the Health dashboard. `rawValue` is the API measurement kind.
public enum TrackedMetric: String, CaseIterable, Sendable, Identifiable {
    case steps
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case sleep
    case activeEnergy = "active_energy"
    case weight

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .steps: return "Steps"
        case .heartRate: return "Heart rate"
        case .restingHeartRate: return "Resting heart rate"
        case .sleep: return "Sleep"
        case .activeEnergy: return "Active energy"
        case .weight: return "Weight"
        }
    }

    /// Canonical unit, matching services/api MEASUREMENT_UNITS.
    public var unit: String {
        switch self {
        case .steps: return "steps"
        case .heartRate, .restingHeartRate: return "bpm"
        case .sleep: return "min"
        case .activeEnergy: return "kcal"
        case .weight: return "kg"
        }
    }

    /// Daily totals (true) or daily averages (false).
    public var isCumulative: Bool {
        switch self {
        case .steps, .sleep, .activeEnergy: return true
        case .heartRate, .restingHeartRate, .weight: return false
        }
    }

    public var tone: Tone {
        switch self {
        case .steps: return .green
        case .heartRate, .restingHeartRate: return .red
        case .sleep: return .purple
        case .activeEnergy: return .orange
        case .weight: return .teal
        }
    }

    /// How weight is shown (Settings › Display). Stored values stay in kilograms.
    nonisolated(unsafe) public static var weightUnit: WeightUnit = .kilograms

    /// A stored value in the person's units (only weight differs).
    public func displayValue(_ value: Double) -> Double {
        self == .weight && Self.weightUnit == .pounds ? value * WeightUnit.poundsPerKilogram : value
    }

    public func format(_ value: Double) -> String {
        switch self {
        case .sleep: return HealthFormat.duration(minutes: value)
        case .weight: return displayValue(value).formatted(.number.precision(.fractionLength(1)))
        default: return HealthFormat.number(value)
        }
    }

    /// Unit shown after a formatted value (nil when the format already says it).
    public var displayUnit: String? {
        switch self {
        case .sleep: return nil
        case .steps: return nil
        case .weight: return Self.weightUnit == .pounds ? "lb" : "kg"
        default: return unit
        }
    }
}

public struct DailyValue: Equatable, Sendable, Identifiable, Codable {
    /// Start of the local day.
    public let date: Date
    public let value: Double
    public var id: Date { date }

    public init(date: Date, value: Double) {
        self.date = date
        self.value = value
    }
}

/// Summary of a metric over a period, compared with the person's own baseline.
public struct TrendSummary: Equatable, Sendable {
    public let average: Double?
    public let baselineAverage: Double?
    public let trend: MetricTrend
    public let daysWithData: Int
}

public enum TrendAnalysis {
    /// Minimum number of baseline days before comparing — fewer is too noisy.
    public static let minimumBaselineDays = 4

    public static func average(_ values: [DailyValue]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0) { $0 + $1.value } / Double(values.count)
    }

    /// Compares the recent period with the person's own earlier baseline.
    /// `tolerance` is the relative band treated as "in your usual range".
    /// This is context about the person's own pattern, not a clinical judgement.
    public static func summarize(recent: [DailyValue], baseline: [DailyValue], tolerance: Double = 0.1) -> TrendSummary {
        let recentAverage = average(recent)
        let baselineAverage = average(baseline)
        let trend: MetricTrend
        if let recentAverage, let baselineAverage, baseline.count >= minimumBaselineDays, baselineAverage > 0 {
            let change = (recentAverage - baselineAverage) / baselineAverage
            if abs(change) <= tolerance {
                trend = .inUsualRange
            } else {
                trend = change > 0 ? .aboveUsual : .belowUsual
            }
        } else {
            trend = .noBaseline
        }
        return TrendSummary(average: recentAverage, baselineAverage: baselineAverage, trend: trend, daysWithData: recent.count)
    }

    /// Splits a series into (recent `days`, the `days` before that).
    public static func split(_ values: [DailyValue], days: Int, now: Date, calendar: Calendar = .current) -> (recent: [DailyValue], baseline: [DailyValue]) {
        let today = calendar.startOfDay(for: now)
        guard let recentStart = calendar.date(byAdding: .day, value: -(days - 1), to: today),
              let baselineStart = calendar.date(byAdding: .day, value: -days, to: recentStart)
        else { return ([], []) }
        let recent = values.filter { $0.date >= recentStart && $0.date <= today }
        let baseline = values.filter { $0.date >= baselineStart && $0.date < recentStart }
        return (recent, baseline)
    }

    /// Completed days only (not today) as idempotent uploads — today's total
    /// is still changing, so it's sent once the day is over.
    public static func uploads(for metric: TrackedMetric, values: [DailyValue], now: Date, calendar: Calendar = .current) -> [MeasurementUpload] {
        let today = calendar.startOfDay(for: now)
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return values.filter { $0.date < today }.map { value in
            // Recorded at local noon so the server's per-day bucketing matches the device's day.
            let recordedAt = calendar.date(byAdding: .hour, value: 12, to: value.date) ?? value.date
            return MeasurementUpload(
                kind: metric.rawValue,
                value: value.value,
                recordedAt: recordedAt,
                source: "apple_health",
                sourceDevice: nil,
                externalId: "apple_health:\(metric.rawValue):\(formatter.string(from: value.date))"
            )
        }
    }
}

public enum WeightUnit: String, CaseIterable, Identifiable, Sendable {
    case kilograms, pounds
    public static let poundsPerKilogram = 2.20462262
    public var id: String { rawValue }
    public var label: String { self == .kilograms ? "Kilograms (kg)" : "Pounds (lb)" }
    /// The account-level unit system this display choice corresponds to.
    public var unitSystem: UnitSystem { self == .pounds ? .imperial : .metric }
}
