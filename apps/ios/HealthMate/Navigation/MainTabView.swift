import HealthMateCore
import SwiftUI

/// Bottom tab navigation: Home · Chat · Health · Plans · Profile.
struct MainTabView: View {
    let services: AppServices
    var onSignOut: () -> Void

    @State private var selection: AppTab = .home
    @State private var homeModel: HomeViewModel
    @State private var pendingQuestion: String?

    init(services: AppServices, onSignOut: @escaping () -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        _homeModel = State(initialValue: HomeViewModel(service: services.healthData))
    }

    var body: some View {
        TabView(selection: $selection) {
            HomeView(
                model: homeModel,
                onAsk: { question in
                    pendingQuestion = question
                    selection = .chat
                },
                onNavigate: { selection = $0 }
            )
            .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.systemImage) }
            .tag(AppTab.home)

            ChatPlaceholderView(pendingQuestion: pendingQuestion)
                .tabItem { Label(AppTab.chat.title, systemImage: AppTab.chat.systemImage) }
                .tag(AppTab.chat)

            PlannedFeatureView(
                title: "Health",
                systemImage: "heart.text.square",
                tone: .purple,
                phase: "Phase 5",
                summary: "Vitals, sleep, activity, weight, nutrition and your health timeline — with clear charts and plain-language context."
            )
            .tabItem { Label(AppTab.health.title, systemImage: AppTab.health.systemImage) }
            .tag(AppTab.health)

            PlannedFeatureView(
                title: "My Plan",
                systemImage: "checklist",
                tone: .green,
                phase: "Phase 7",
                summary: "Tasks, medications from your clinician, habits and reminders. HealthMate never invents or changes medical instructions."
            )
            .tabItem { Label(AppTab.plans.title, systemImage: AppTab.plans.systemImage) }
            .tag(AppTab.plans)

            ProfileView(onSignOut: onSignOut)
                .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.systemImage) }
                .tag(AppTab.profile)
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}
