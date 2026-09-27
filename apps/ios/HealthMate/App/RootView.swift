import SwiftUI

/// Switches between onboarding and the main app.
struct RootView: View {
    let services: AppServices
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    var body: some View {
        ZStack {
            if hasCompletedOnboarding {
                MainTabView(services: services, onSignOut: { hasCompletedOnboarding = false })
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            } else {
                OnboardingView(onFinish: { hasCompletedOnboarding = true })
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.45), value: hasCompletedOnboarding)
    }
}
