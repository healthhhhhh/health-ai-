import HealthMateCore
import SwiftUI

/// Home dashboard (reference: second iOS screen).
struct HomeView: View {
    let model: HomeViewModel
    var onAsk: (String) -> Void
    var onNavigate: (AppTab) -> Void

    @State private var question = ""

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            ScrollView {
                Group {
                    switch model.state {
                    case .idle, .loading:
                        loadingContent
                    case .failed(let message):
                        EmptyStateView(systemImage: "wifi.exclamationmark", tone: .orange, title: "We couldn't load your dashboard", message: message) {
                            Button("Try again") { Task { await model.load() } }
                                .buttonStyle(.hmPrimary)
                        }
                        .padding(.top, 80)
                    case .loaded:
                        if let summary = model.summary { content(summary) }
                    }
                }
                .padding(.horizontal, HM.Spacing.lg)
                .padding(.bottom, HM.Spacing.xxl)
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .task(id: model.state) { await debugScroll(proxy) }
            }
            .refreshable { await model.load() }
            .task { await model.loadIfNeeded() }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                // Zero-height inset whose background fills the status-bar area.
                Color.clear.frame(height: 0).background(.bar, ignoresSafeAreaEdges: .top)
            }
            .overlay(alignment: .bottom) { toast }
            .animation(HMMotion.spring, value: model.actionError)
        }
    }

    @ViewBuilder
    private func content(_ summary: HomeSummary) -> some View {
        VStack(alignment: .leading, spacing: HM.Spacing.xl) {
            VStack(alignment: .leading, spacing: HM.Spacing.md) {
                if model.isSampleData { SampleDataBanner() }
                HomeHeader(user: summary.user, unreadNotifications: summary.unreadNotifications)
                AskBar(text: $question, onSubmit: onAsk, onVoice: { onNavigate(.chat) })
            }
            .appearAnimation()

            AssistantHeroCard(firstName: summary.user.firstName) { onNavigate(.chat) }
                .appearAnimation(delay: 0.06)

            TodaysHealthGrid(metrics: summary.metrics) { onNavigate(.health) }
                .id("health")

            MoodCheckInCard(mood: model.mood) { mood in
                Task { await model.selectMood(mood) }
            }
            .appearAnimation(delay: 0.25)

            if let insight = summary.insight {
                InsightCard(message: insight.message, basedOn: insight.basedOn, isSample: insight.source == .sample)
                    .appearAnimation(delay: 0.3)
            }

            TodaysPlanCard(
                tasks: model.tasks,
                progress: model.progress,
                celebrationCount: model.celebrationCount,
                onToggle: { id in Task { await model.toggleTask(id: id) } },
                onViewPlan: { onNavigate(.plans) }
            )
            .appearAnimation(delay: 0.35)
            .id("plan")

            AppointmentsCard(appointments: summary.upcomingAppointments)
            RecentActivityCard(events: summary.recentActivity)
                .id("activity")
            DisclaimerView()
        }
        .padding(.top, HM.Spacing.xs)
    }

    /// Debug builds only: `-hmScrollTarget plan` scrolls to a section after
    /// loading, so CI can screenshot every part of Home.
    private func debugScroll(_ proxy: ScrollViewProxy) async {
        #if DEBUG
        guard model.state == .loaded,
              let target = UserDefaults.standard.string(forKey: "hmScrollTarget"),
              !target.isEmpty else { return }
        try? await Task.sleep(for: .seconds(1.5))
        proxy.scrollTo(target, anchor: .top)
        #endif
    }

    /// Skeleton that mirrors the real layout while data loads.
    private var loadingContent: some View {
        content(SampleData.homeSummary(now: Date()))
            .redacted(reason: .placeholder)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .overlay(alignment: .top) {
                ProgressView().padding(.top, 8).accessibilityLabel("Loading your dashboard")
            }
    }

    @ViewBuilder private var toast: some View {
        if let message = model.actionError {
            ToastView(message: message)
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(3))
                    withAnimation(HMMotion.spring) { model.actionError = nil }
                }
        }
    }
}

#Preview("Home") {
    HomeView(model: HomeViewModel(service: MockHealthDataService()), onAsk: { _ in }, onNavigate: { _ in })
}
