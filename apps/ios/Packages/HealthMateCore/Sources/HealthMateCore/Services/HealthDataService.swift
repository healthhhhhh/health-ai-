import Foundation

/// The iOS app's view of the shared HealthMate API. Views and view models
/// depend on this protocol only; `AppEnvironment` chooses the implementation.
public protocol HealthDataService: Sendable {
    /// True when the service returns sample data; the UI must label it.
    var isSampleData: Bool { get }
    func homeSummary() async throws -> HomeSummary
    func setTask(id: String, completed: Bool) async throws -> PlanTask
    func recordMood(_ mood: Mood) async throws -> MoodCheckIn
}

public enum HealthDataError: Error, Equatable, LocalizedError {
    case notFound
    case network
    case server(status: Int)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .notFound: return "We couldn't find that item."
        case .network: return "We couldn't reach HealthMate. Check your connection and try again."
        case .server: return "Something went wrong on our side. Please try again."
        case .decoding: return "We received an unexpected response. Please try again."
        }
    }
}
