import SwiftUI

/// Switches between onboarding and the main app.
struct RootView: View {
    let services: AppServices
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var session: SessionStore

    init(services: AppServices) {
        self.services = services
        _session = State(initialValue: SessionStore(api: services.api))
    }

    var body: some View {
        ZStack {
            if hasCompletedOnboarding {
                MainTabView(services: services, session: session, onRestartOnboarding: { hasCompletedOnboarding = false })
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            } else {
                OnboardingView(session: session, onFinish: { hasCompletedOnboarding = true })
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.45), value: hasCompletedOnboarding)
        .task { await session.restore() }
    }
}
