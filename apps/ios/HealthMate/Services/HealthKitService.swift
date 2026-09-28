import Foundation
import HealthKit
import HealthMateCore

/// Reads the Apple Health data the person chooses to share. Read-only:
/// HealthMate never writes to Apple Health.
protocol HealthDataReading: Sendable {
    var isAvailable: Bool { get }
    func requestAuthorization() async throws
    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue]
}

final class HealthKitService: HealthDataReading, @unchecked Sendable {
    private let store = HKHealthStore()
    private let calendar = Calendar.current

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private static let quantityTypes: [TrackedMetric: HKQuantityTypeIdentifier] = [
        .steps: .stepCount,
        .heartRate: .heartRate,
        .restingHeartRate: .restingHeartRate,
        .activeEnergy: .activeEnergyBurned,
        .weight: .bodyMass,
    ]

    private static func unit(for metric: TrackedMetric) -> HKUnit {
        switch metric {
        case .steps: return .count()
        case .heartRate, .restingHeartRate: return HKUnit.count().unitDivided(by: .minute())
        case .activeEnergy: return .kilocalorie()
        case .weight: return .gramUnit(with: .kilo)
        case .sleep: return .minute()
        }
    }

    func requestAuthorization() async throws {
        var read: Set<HKObjectType> = Set(Self.quantityTypes.values.map { HKQuantityType($0) })
        read.insert(HKCategoryType(.sleepAnalysis))
        try await store.requestAuthorization(toShare: [], read: read)
    }

    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue] {
        let end = now
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: now)) ?? now
        if metric == .sleep { return try await sleepMinutes(start: start, end: end) }
        guard let identifier = Self.quantityTypes[metric] else { return [] }

        let type = HKQuantityType(identifier)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
            options: metric.isCumulative ? .cumulativeSum : .discreteAverage,
            anchorDate: calendar.startOfDay(for: now),
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await descriptor.result(for: store)
        let unit = Self.unit(for: metric)
        var values: [DailyValue] = []
        collection.enumerateStatistics(from: start, to: end) { statistics, _ in
            let quantity = metric.isCumulative ? statistics.sumQuantity() : statistics.averageQuantity()
            if let quantity {
                values.append(DailyValue(date: statistics.startDate, value: quantity.doubleValue(for: unit)))
            }
        }
        return values
    }

    /// Minutes asleep per night, attributed to the day the person woke up.
    private func sleepMinutes(start: Date, end: Date) async throws -> [DailyValue] {
        // Include the evening before the first day so that night counts.
        let queryStart = calendar.date(byAdding: .hour, value: -12, to: start) ?? start
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: queryStart, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let samples = try await descriptor.result(for: store)
        let asleep = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)
        var intervalsByDay: [Date: [DateInterval]] = [:]
        for sample in samples where asleep.contains(sample.value) {
            let day = calendar.startOfDay(for: sample.endDate)
            guard day >= start else { continue }
            intervalsByDay[day, default: []].append(DateInterval(start: sample.startDate, end: sample.endDate))
        }
        // Watch and phone can both record the same night; merge overlaps so it isn't counted twice.
        return intervalsByDay.map { day, intervals in
            DailyValue(date: day, value: (Self.mergedDuration(intervals) / 60).rounded())
        }
        .sorted { $0.date < $1.date }
    }

    static func mergedDuration(_ intervals: [DateInterval]) -> TimeInterval {
        var total: TimeInterval = 0
        var current: DateInterval?
        for interval in intervals.sorted(by: { $0.start < $1.start }) {
            if let open = current, interval.start <= open.end {
                current = DateInterval(start: open.start, end: max(open.end, interval.end))
            } else {
                if let open = current { total += open.duration }
                current = interval
            }
        }
        if let open = current { total += open.duration }
        return total
    }
}

/// Deterministic reader for previews and tests.
struct StaticHealthReader: HealthDataReading {
    var isAvailable = true
    var values: [TrackedMetric: [DailyValue]] = [:]
    func requestAuthorization() async throws {}
    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue] { values[metric] ?? [] }
}
