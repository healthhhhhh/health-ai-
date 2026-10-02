import Foundation
import HealthKit
import HealthMateCore

/// Reads the Apple Health data the person chooses to share. Read-only:
/// HealthMate never writes to Apple Health.
protocol HealthDataReading: Sendable {
    var isAvailable: Bool { get }
    func requestAuthorization() async throws
    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue]
    /// Every tracked metric for local days in [from, to), for syncing to the account.
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue]
    /// True when HealthMate should ask again (e.g. a data type was added since the person last answered).
    /// HealthKit never reveals whether *read* access was granted, only whether asking would show the sheet.
    func shouldRequestAuthorization() async -> Bool
    /// Account setup only: the same sheet, also offering date of birth (used solely to prefill the setup form).
    func requestAuthorizationForSetup() async throws
    /// The date of birth Apple Health shares, if the person allowed it. Only a prefill — never proof of age.
    func dateOfBirth() -> DateComponents?
}

extension HealthDataReading {
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue] {
        let calendar = Calendar.current
        let days = max(1, calendar.dateComponents([.day], from: from, to: to).day ?? 1)
        let last = calendar.date(byAdding: .second, value: -1, to: to) ?? to
        var result: [DailyMetricValue] = []
        for metric in TrackedMetric.allCases {
            for value in try await dailyValues(metric, days: days, now: last) where value.date >= from && value.date < to {
                result.append(DailyMetricValue(metric: metric, day: value.date, value: value.value))
            }
        }
        return result
    }

    func shouldRequestAuthorization() async -> Bool { false }

    func requestAuthorizationForSetup() async throws { try await requestAuthorization() }

    func dateOfBirth() -> DateComponents? { nil }
}

/// The sync engine's view of the reader.
struct HealthReaderSource: DailyHealthSource {
    let reader: any HealthDataReading
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue] {
        try await reader.dailyMetricValues(from: from, to: to)
    }
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

    private static var readTypes: Set<HKObjectType> {
        var read: Set<HKObjectType> = Set(quantityTypes.values.map { HKQuantityType($0) })
        read.insert(HKCategoryType(.sleepAnalysis))
        return read
    }

    func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    /// Setup also offers date of birth. It isn't part of `readTypes`, so people who skip it
    /// aren't asked again later ("Review Apple Health access" only follows the metrics).
    func requestAuthorizationForSetup() async throws {
        var read = Self.readTypes
        read.insert(HKCharacteristicType(.dateOfBirth))
        try await store.requestAuthorization(toShare: [], read: read)
    }

    func dateOfBirth() -> DateComponents? {
        try? store.dateOfBirthComponents()
    }

    func shouldRequestAuthorization() async -> Bool {
        guard isAvailable else { return false }
        return (try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)) == .shouldRequest
    }

    /// Full days for syncing: totals (or average, lowest and highest) per metric, as HealthKit computes them
    /// across iPhone and Apple Watch without double counting.
    func dailyMetricValues(from: Date, to: Date) async throws -> [DailyMetricValue] {
        var result: [DailyMetricValue] = []
        for metric in TrackedMetric.allCases {
            if metric == .sleep {
                for value in try await sleepMinutes(start: from, end: to) where value.date < to {
                    result.append(DailyMetricValue(metric: .sleep, day: value.date, value: value.value))
                }
                continue
            }
            guard let identifier = Self.quantityTypes[metric] else { continue }
            let descriptor = HKStatisticsCollectionQueryDescriptor(
                predicate: HKSamplePredicate.quantitySample(type: HKQuantityType(identifier), predicate: HKQuery.predicateForSamples(withStart: from, end: to)),
                options: metric.isCumulative ? .cumulativeSum : [.discreteAverage, .discreteMin, .discreteMax],
                anchorDate: from,
                intervalComponents: DateComponents(day: 1)
            )
            let collection = try await descriptor.result(for: store)
            let unit = Self.unit(for: metric)
            collection.enumerateStatistics(from: from, to: to) { statistics, _ in
                if metric.isCumulative {
                    if let sum = statistics.sumQuantity() {
                        result.append(DailyMetricValue(metric: metric, day: statistics.startDate, value: sum.doubleValue(for: unit)))
                    }
                } else if let average = statistics.averageQuantity() {
                    result.append(DailyMetricValue(
                        metric: metric,
                        day: statistics.startDate,
                        value: average.doubleValue(for: unit),
                        min: statistics.minimumQuantity()?.doubleValue(for: unit),
                        max: statistics.maximumQuantity()?.doubleValue(for: unit)
                    ))
                }
            }
        }
        return result
    }

    /// Wakes HealthMate (hourly at most) when new Apple Health data arrives, so it can sync in the background.
    /// Needs the HealthKit background-delivery entitlement; if it fails, syncing waits for the next app open.
    func observeChanges(_ onChange: @escaping @Sendable () async -> Void) {
        let types: [HKSampleType] = Self.quantityTypes.values.map { HKQuantityType($0) } + [HKCategoryType(.sleepAnalysis)]
        for type in types {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                Task {
                    await onChange()
                    completion()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
        }
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
