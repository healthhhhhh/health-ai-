import Foundation
import HealthMateCore

/// Composition root: picks service implementations from build configuration.
/// Set `HM_DATA_SOURCE = api` and `HM_API_BASE_URL` in project.yml (or an
/// .xcconfig) to talk to the shared backend instead of sample data.
struct AppServices {
    let healthData: any HealthDataService
    let planRepository: any PlanRepository
    let reminders: any ReminderScheduling
    /// HealthMate server client for account features (AI assistant, reports,
    /// photo analysis, memory, sync). Model API keys live only on the server.
    let api: APIClient
    let healthReader: any HealthDataReading

    static let defaultAPIBaseURL = URL(string: "http://localhost:4000/v1")!

    static func live(bundle: Bundle = .main) -> AppServices {
        let source = bundle.object(forInfoDictionaryKey: "HMDataSource") as? String
        let baseURL = (bundle.object(forInfoDictionaryKey: "HMAPIBaseURL") as? String).flatMap(URL.init(string:)) ?? defaultAPIBaseURL
        // The plan is stored on this device only (local-first).
        let planRepository: any PlanRepository
        if let url = try? FilePlanRepository.defaultFileURL() {
            planRepository = FilePlanRepository(fileURL: url)
        } else {
            planRepository = InMemoryPlanRepository()
        }
        let reminders = NotificationReminderScheduler()
        let api = APIClient(baseURL: baseURL, tokens: KeychainTokenStore())
        let healthData: any HealthDataService = source == "api"
            ? HTTPHealthDataService(baseURL: baseURL)
            : MockHealthDataService(latency: .milliseconds(350))
        return AppServices(healthData: healthData, planRepository: planRepository, reminders: reminders, api: api, healthReader: HealthKitService())
    }

    static let preview = AppServices(
        healthData: MockHealthDataService(),
        planRepository: InMemoryPlanRepository(),
        reminders: RecordingReminderScheduler(),
        api: APIClient(baseURL: defaultAPIBaseURL, tokens: InMemoryTokenStore()),
        healthReader: StaticHealthReader()
    )
}

enum AppLinks {
    // Placeholder URLs until the legal pages are published.
    static let terms = URL(string: "https://healthmate.example/terms")!
    static let privacy = URL(string: "https://healthmate.example/privacy")!
}
