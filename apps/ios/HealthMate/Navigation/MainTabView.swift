import HealthMateCore
import SwiftUI

/// Bottom tab navigation: Home · Chat · Health · Plans · Profile.
struct MainTabView: View {
    let services: AppServices
    let session: SessionStore
    var onRestartOnboarding: () -> Void

    @State private var selection: AppTab
    @State private var homeModel: HomeViewModel
    @State private var planStore: PlanStore
    @State private var chatModel: ChatViewModel
    @State private var pendingQuestion: String?
    @State private var showCareFinder = false
    @State private var showCare = false
    @State private var showVoice = false
    @State private var healthSync: HealthSyncCoordinator
    @Environment(\.scenePhase) private var scenePhase

    init(services: AppServices, session: SessionStore, onRestartOnboarding: @escaping () -> Void) {
        self.services = services
        self.session = session
        self.onRestartOnboarding = onRestartOnboarding
        _homeModel = State(initialValue: HomeViewModel(service: services.healthData))
        _planStore = State(initialValue: PlanStore(repository: services.planRepository, reminders: services.reminders))
        _chatModel = State(initialValue: ChatViewModel(api: services.api, onSessionEnded: { [session] error in session.handle(error) }))
        _healthSync = State(initialValue: HealthSyncCoordinator(session: session, reader: services.healthReader))
        var initial = AppTab.home
        #if DEBUG
        // `-hmInitialTab plans` lets CI screenshot a specific tab.
        if let raw = UserDefaults.standard.string(forKey: "hmInitialTab"), let tab = AppTab(rawValue: raw) { initial = tab }
        #endif
        _selection = State(initialValue: initial)
    }

    var body: some View {
        TabView(selection: $selection) {
            HomeView(
                model: homeModel,
                plan: planStore,
                onAsk: { question in
                    pendingQuestion = question
                    selection = .chat
                },
                onNavigate: { selection = $0 },
                onVoice: { showVoice = true },
                isDemoAccount: session.isSignedIn && session.isDemo,
                isPreview: session.isPreview,
                session: session,
                healthReader: services.healthReader,
                onRoute: open
            )
            .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.systemImage) }
            .tag(AppTab.home)

            ChatView(
                session: session,
                model: chatModel,
                pendingQuestion: $pendingQuestion,
                onFindCare: { showCareFinder = true },
                onVoice: { showVoice = true }
            )
            .tabItem { Label(AppTab.chat.title, systemImage: AppTab.chat.systemImage) }
            .tag(AppTab.chat)

            HealthDashboardView(session: session, reader: services.healthReader, sync: healthSync)
                .tabItem { Label(AppTab.health.title, systemImage: AppTab.health.systemImage) }
                .tag(AppTab.health)

            PlanView(store: planStore, session: session)
                .tabItem { Label(AppTab.plans.title, systemImage: AppTab.plans.systemImage) }
                .tag(AppTab.plans)

            ProfileView(session: session, onRestartOnboarding: onRestartOnboarding)
                .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.systemImage) }
                .tag(AppTab.profile)
        }
        .environment(\.askAssistant, AskAssistantAction { question in
            pendingQuestion = question
            selection = .chat
        })
        .sensoryFeedback(.selection, trigger: selection)
        .task {
            await planStore.loadIfNeeded()
            // Keeps Apple Health in step with the account (only when signed in with sync turned on).
            await healthSync.syncIfNeeded()
        }
        // Home reflects the account and Apple Health, so refresh it when either may have changed.
        .onChange(of: session.state) { _, _ in
            Task {
                await homeModel.load()
                await healthSync.syncIfNeeded()
            }
        }
        .onChange(of: selection) { _, tab in
            if tab == .home { Task { await homeModel.load() } }
            if tab == .plans { Task { await planStore.load() } } // picks up changes made on the web
        }
        // Turning on Apple Health sync in Privacy starts the import straight away.
        .onChange(of: session.hasConsent("health_data_sync")) { _, granted in
            if granted { Task { await healthSync.syncIfNeeded() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await planStore.load()
                    await healthSync.syncIfNeeded()
                }
            }
        }
        .sheet(isPresented: $showCareFinder) {
            CareFinderView()
        }
        .sheet(isPresented: $showCare) {
            NavigationStack {
                CareHubView(api: session.api)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showCare = false } } }
            }
        }
        .sheet(isPresented: $showVoice) {
            VoiceInputView { transcript in
                pendingQuestion = transcript
                selection = .chat
            }
            .presentationDetents([.medium])
        }
    }

    /// Destinations from Home links that live in another tab.
    private func open(_ route: AppRoute) {
        switch route {
        case .home, .notifications: selection = .home
        case .chat: selection = .chat
        case .conversation(let id):
            selection = .chat
            Task { await chatModel.openConversation(id: id) }
        case .health, .metric, .timeline, .reports, .report: selection = .health
        case .plans, .planItem: selection = .plans
        // Signed in: the care hub (appointments, care team, find care). Signed out: finding care nearby.
        case .care, .appointment:
            if session.isSignedIn { showCare = true } else { showCareFinder = true }
        case .profile, .settings, .account: selection = .profile
        }
    }
}
