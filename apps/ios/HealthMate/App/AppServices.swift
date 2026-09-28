import Foundation
import HealthMateCore

/// Composition root: picks service implementations from build configuration.
/// Set `HM_DATA_SOURCE = api` and `HM_API_BASE_URL` in project.yml (or an
/// .xcconfig) to talk to the shared backend instead of sample data.
struct AppServices {
    let healthData: any HealthDataService
    let planRepository: any PlanRepository
    let reminders: any ReminderScheduling

    static func live(bundle: Bundle = .main) -> AppServices {
        let source = bundle.object(forInfoDictionaryKey: "HMDataSource") as? String
        let baseURLString = bundle.object(forInfoDictionaryKey: "HMAPIBaseURL") as? String
        // The plan is stored on this device only (local-first).
        let planRepository: any PlanRepository
        if let url = try? FilePlanRepository.defaultFileURL() {
            planRepository = FilePlanRepository(fileURL: url)
        } else {
            planRepository = InMemoryPlanRepository()
        }
        let reminders = NotificationReminderScheduler()
        if source == "api", let baseURLString, let url = URL(string: baseURLString) {
            return AppServices(healthData: HTTPHealthDataService(baseURL: url), planRepository: planRepository, reminders: reminders)
        }
        return AppServices(healthData: MockHealthDataService(latency: .milliseconds(350)), planRepository: planRepository, reminders: reminders)
    }

    static let preview = AppServices(healthData: MockHealthDataService(), planRepository: InMemoryPlanRepository(), reminders: RecordingReminderScheduler())
}

enum AppLinks {
    // Placeholder URLs until the legal pages are published.
    static let terms = URL(string: "https://healthmate.example/terms")!
    static let privacy = URL(string: "https://healthmate.example/privacy")!
}
