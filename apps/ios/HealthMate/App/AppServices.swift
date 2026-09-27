import Foundation
import HealthMateCore

/// Composition root: picks service implementations from build configuration.
/// Set `HM_DATA_SOURCE = api` and `HM_API_BASE_URL` in project.yml (or an
/// .xcconfig) to talk to the shared backend instead of sample data.
struct AppServices {
    let healthData: any HealthDataService

    static func live(bundle: Bundle = .main) -> AppServices {
        let source = bundle.object(forInfoDictionaryKey: "HMDataSource") as? String
        let baseURLString = bundle.object(forInfoDictionaryKey: "HMAPIBaseURL") as? String
        if source == "api", let baseURLString, let url = URL(string: baseURLString) {
            return AppServices(healthData: HTTPHealthDataService(baseURL: url))
        }
        return AppServices(healthData: MockHealthDataService(latency: .milliseconds(350)))
    }

    static let preview = AppServices(healthData: MockHealthDataService())
}

enum AppLinks {
    // Placeholder URLs until the legal pages are published.
    static let terms = URL(string: "https://healthmate.example/terms")!
    static let privacy = URL(string: "https://healthmate.example/privacy")!
}
