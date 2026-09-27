import HealthMateCore
import SwiftUI

@main
struct HealthMateApp: App {
    private let services = AppServices.live()

    var body: some Scene {
        WindowGroup {
            RootView(services: services)
                .tint(HM.Colors.primary)
        }
    }
}
