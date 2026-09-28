import Foundation
import HealthMateCore

/// Composition root: picks service implementations from build configuration.
/// `HM_API_BASE_URL` in project.yml points at the HealthMate API.
/// `HM_DATA_SOURCE = sample` shows labelled demo data on Home instead of the person's own.
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
        let localPlan: any PlanRepository
        let fileURL = try? FilePlanRepository.defaultFileURL()
        if let fileURL {
            localPlan = FilePlanRepository(fileURL: fileURL)
        } else {
            localPlan = InMemoryPlanRepository()
        }
        let reminders = NotificationReminderScheduler()
        var tokens: any TokenStore = KeychainTokenStore()
        #if DEBUG
        // Demo sign-in for screenshots keeps tokens in memory (unsigned simulator builds may lack Keychain access).
        if UserDefaults.standard.string(forKey: "hmDemoEmail") != nil { tokens = InMemoryTokenStore() }
        #endif
        let api = APIClient(baseURL: baseURL, tokens: tokens)
        // The plan works offline on the device and is shared with the account (web app) when signed in.
        let planRepository = SyncingPlanRepository(local: localPlan, transport: api, stateURL: fileURL?.deletingLastPathComponent().appendingPathComponent("plan-sync.json"))
        let healthReader = HealthKitService()
        // "sample" shows labelled demo data on Home; anything else uses the person's real data.
        var useSample = source == "sample"
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "hmDataSource") { useSample = override == "sample" }
        #endif
        let healthData: any HealthDataService = useSample
            ? MockHealthDataService(latency: .milliseconds(350))
            : LiveHomeService(reader: healthReader, api: api, moods: UserDefaultsMoodStore())
        return AppServices(healthData: healthData, planRepository: planRepository, reminders: reminders, api: api, healthReader: healthReader)
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
