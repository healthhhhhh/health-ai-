import HealthMateCore
import SwiftUI

@main
struct HealthMateApp: App {
    private let services: AppServices

    init() {
        #if DEBUG
        // UI tests: `-hmResetOnboarding YES` starts from the welcome screen without pinning the flag.
        if UserDefaults.standard.bool(forKey: "hmResetOnboarding") {
            UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
        }
        #endif
        services = AppServices.live()
    }

    var body: some Scene {
        WindowGroup {
            RootView(services: services)
                .tint(HM.Colors.primary)
        }
    }
}
