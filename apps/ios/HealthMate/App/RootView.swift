import SwiftUI

/// Switches between the welcome screens, first-run account setup and the main app.
struct RootView: View {
    let services: AppServices
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var session: SessionStore

    init(services: AppServices) {
        self.services = services
        _session = State(initialValue: SessionStore(api: services.api))
    }

    private enum Screen { case welcome, accountSetup, main }

    private var screen: Screen {
        if !hasCompletedOnboarding { return .welcome }
        // A new account finishes setup (goals, privacy, reminders) before using the app.
        return session.isSignedIn && session.needsAccountSetup ? .accountSetup : .main
    }

    var body: some View {
        ZStack {
            switch screen {
            case .welcome:
                OnboardingView(session: session, onFinish: { hasCompletedOnboarding = true })
                    .transition(.opacity)
            case .accountSetup:
                AccountSetupView(session: session, reminders: services.reminders, healthReader: services.healthReader)
                    .transition(.opacity)
            case .main:
                MainTabView(services: services, session: session, onRestartOnboarding: { hasCompletedOnboarding = false })
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            }
        }
        .hmAnimation(.easeInOut(duration: 0.45), value: screen)
        .task { await session.restore() }
    }
}
