import SwiftUI

/// Switches between the welcome screens, first-run account setup and the main app.
struct RootView: View {
    let services: AppServices
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var session: SessionStore
    /// One Apple Health sync for the whole app, so the setup import and later syncs share progress.
    @State private var healthSync: HealthSyncCoordinator

    init(services: AppServices) {
        self.services = services
        let session = SessionStore(api: services.api)
        _session = State(initialValue: session)
        _healthSync = State(initialValue: HealthSyncCoordinator(session: session, reader: services.healthReader))
    }

    private enum Screen { case welcome, accountSetup, main }

    private var screen: Screen {
        if !hasCompletedOnboarding { return .welcome }
        // A new account finishes setup (and confirms its age) before using the app.
        return session.isSignedIn && session.needsAccountSetup ? .accountSetup : .main
    }

    var body: some View {
        ZStack {
            switch screen {
            case .welcome:
                OnboardingView(session: session, onFinish: { hasCompletedOnboarding = true })
                    .transition(.opacity)
            case .accountSetup:
                AccountSetupView(session: session, healthReader: services.healthReader, healthSync: healthSync)
                    .transition(.opacity)
            case .main:
                MainTabView(services: services, session: session, healthSync: healthSync, onRestartOnboarding: { hasCompletedOnboarding = false })
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            }
        }
        .hmAnimation(.easeInOut(duration: 0.45), value: screen)
        .task { await session.restore() }
    }
}
