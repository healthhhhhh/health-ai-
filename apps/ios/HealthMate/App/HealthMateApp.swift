import HealthMateCore
import SwiftUI

@main
struct HealthMateApp: App {
    private let services: AppServices
    @AppStorage("hmAppearance") private var appearance = Appearance.system.rawValue
    @AppStorage("hmWeightUnit") private var weightUnit = WeightUnit.kilograms.rawValue

    init() {
        #if DEBUG
        // UI tests: `-hmResetOnboarding YES` starts from the welcome screen without pinning the flag.
        if UserDefaults.standard.bool(forKey: "hmResetOnboarding") {
            UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
        }
        #endif
        services = AppServices.live()
        TrackedMetric.weightUnit = WeightUnit(rawValue: UserDefaults.standard.string(forKey: "hmWeightUnit") ?? "") ?? .kilograms
    }

    var body: some Scene {
        WindowGroup {
            RootView(services: services)
                .tint(HM.Colors.primary)
                .preferredColorScheme(Appearance(rawValue: appearance)?.colorScheme)
                .onChange(of: weightUnit) { _, raw in TrackedMetric.weightUnit = WeightUnit(rawValue: raw) ?? .kilograms }
        }
    }
}

/// Settings › Display › Appearance.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: "Match my device"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
