import Foundation

/// One day of the person's health history: each metric's value that day.
public struct HealthDay: Equatable, Sendable, Identifiable {
    /// Start of the local day.
    public let date: Date
    public var values: [TrackedMetric: Double]
    public var id: Date { date }

    public init(date: Date, values: [TrackedMetric: Double]) {
        self.date = date
        self.values = values
    }
}

/// The person's longitudinal record built from daily values, and how a day
/// compares with their own usual. Mirrors apps/web/src/lib/health-history.ts.
public enum HealthHistory {
    /// Metrics shown in the daily history, in display order.
    public static let metrics: [TrackedMetric] = [.sleep, .steps, .restingHeartRate, .heartRate, .activeEnergy, .weight]

    /// One entry per day that has any reading, newest first.
    public static func days(from series: [TrackedMetric: [DailyValue]], calendar: Calendar = .current) -> [HealthDay] {
        var byDay: [Date: HealthDay] = [:]
        for metric in metrics {
            for value in series[metric] ?? [] {
                let day = calendar.startOfDay(for: value.date)
                var entry = byDay[day] ?? HealthDay(date: day, values: [:])
                entry.values[metric] = value.value
                byDay[day] = entry
            }
        }
        return byDay.values.sorted { $0.date > $1.date }
    }

    /// A day's value against the person's average over the `window` earlier days
    /// that have it (within 10% = their usual range). Needs at least 5 earlier days.
    public static func compare(_ days: [HealthDay], date: Date, metric: TrackedMetric, window: Int = 30) -> (usual: Double?, trend: MetricTrend) {
        guard let value = days.first(where: { $0.date == date })?.values[metric] else { return (nil, .noBaseline) }
        let earlier = days.filter { $0.date < date }.compactMap { $0.values[metric] }.prefix(window)
        guard earlier.count >= 5 else { return (nil, .noBaseline) }
        let usual = earlier.reduce(0, +) / Double(earlier.count)
        let change = (value - usual) / usual
        if abs(change) <= 0.1 { return (usual, .inUsualRange) }
        return (usual, change > 0 ? .aboveUsual : .belowUsual)
    }
}
