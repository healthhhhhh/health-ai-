import Foundation

/// Apple Health–style daily values from the sample account, for Preview mode
/// (no HealthKit access, no real data).
public struct SampleHealthSeries: Sendable {
    private let daily: [String: [DailyValue]]

    public init(account: JSONValue = SampleAccount.load(), calendar: Calendar = .current) {
        var result: [String: [DailyValue]] = [:]
        for (kind, points) in account["measurements"]["daily"].object {
            result[kind] = points.array.compactMap { point in
                guard let day = point["date"].string.flatMap({ SampleAccount.day($0, calendar: calendar) }), let value = point["value"].double else { return nil }
                return DailyValue(date: day, value: value)
            }
        }
        daily = result
    }

    /// The last `days` days ending today (today may be partial, like real Apple Health).
    public func values(_ metric: TrackedMetric, days: Int, now: Date = Date(), calendar: Calendar = .current) -> [DailyValue] {
        let today = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) else { return [] }
        return (daily[metric.rawValue] ?? []).filter { $0.date >= start && $0.date <= today }
    }
}
