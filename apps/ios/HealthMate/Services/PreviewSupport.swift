import Foundation
import HealthMateCore

/// Preview mode (Phase 1): the whole app runs on the on-device sample account
/// (`PreviewBackend`) — no server, no real AI, no HealthKit access.
enum PreviewSettings {
    static let stateKey = "hmPreviewState"

    /// Debug state chosen in Profile › Preview mode (or `-hmPreviewState empty` at launch).
    static var state: PreviewState {
        get { PreviewState(rawValue: UserDefaults.standard.string(forKey: stateKey) ?? "") ?? .normal }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: stateKey) }
    }
}

struct PreviewHealthAccessDenied: LocalizedError {
    var errorDescription: String? { "Apple Health access is turned off for HealthMate. Turn it on in Settings › Health › Data Access & Devices." }
}

/// Stands in for HealthKit in Preview mode: sample daily values, and the
/// "Permissions off" state behaves like access that was denied.
struct PreviewHealthReader: HealthDataReading {
    private let series = SampleHealthSeries()

    var isAvailable: Bool { true }

    func requestAuthorization() async throws {
        if PreviewSettings.state == .permission { throw PreviewHealthAccessDenied() }
    }

    func dailyValues(_ metric: TrackedMetric, days: Int, now: Date) async throws -> [DailyValue] {
        switch PreviewSettings.state {
        case .permission, .empty:
            return []
        case .loading:
            try await Task.sleep(for: .seconds(3))
        default:
            break
        }
        return series.values(metric, days: days, now: now)
    }
}
