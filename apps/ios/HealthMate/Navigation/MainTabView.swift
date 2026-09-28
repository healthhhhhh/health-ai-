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
    @State private var showVoice = false

    init(services: AppServices, session: SessionStore, onRestartOnboarding: @escaping () -> Void) {
        self.services = services
        self.session = session
        self.onRestartOnboarding = onRestartOnboarding
        _homeModel = State(initialValue: HomeViewModel(service: services.healthData))
        _planStore = State(initialValue: PlanStore(repository: services.planRepository, reminders: services.reminders))
        _chatModel = State(initialValue: ChatViewModel(api: services.api, onSessionEnded: { [session] error in session.handle(error) }))
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
                onVoice: { showVoice = true }
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

            HealthDashboardView(session: session, reader: services.healthReader)
                .tabItem { Label(AppTab.health.title, systemImage: AppTab.health.systemImage) }
                .tag(AppTab.health)

            PlanView(store: planStore)
                .tabItem { Label(AppTab.plans.title, systemImage: AppTab.plans.systemImage) }
                .tag(AppTab.plans)

            ProfileView(session: session, onRestartOnboarding: onRestartOnboarding)
                .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.systemImage) }
                .tag(AppTab.profile)
        }
        .sensoryFeedback(.selection, trigger: selection)
        .task { await planStore.loadIfNeeded() }
        .sheet(isPresented: $showCareFinder) {
            CareFinderView()
        }
        .sheet(isPresented: $showVoice) {
            VoiceInputView { transcript in
                pendingQuestion = transcript
                selection = .chat
            }
            .presentationDetents([.medium])
        }
    }
}
