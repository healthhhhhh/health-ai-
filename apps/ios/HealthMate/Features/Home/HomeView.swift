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
            .refreshable { await model.load() }
            .task { await model.loadIfNeeded() }
            .toolbar(.hidden, for: .navigationBar)
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

            MoodCheckInCard(mood: model.mood) { mood in
                Task { await model.selectMood(mood) }
            }
            .appearAnimation(delay: 0.1)

            TodaysHealthGrid(metrics: summary.metrics) { onNavigate(.health) }

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

            AppointmentsCard(appointments: summary.upcomingAppointments)
            RecentActivityCard(events: summary.recentActivity)
            DisclaimerView()
        }
        .padding(.top, HM.Spacing.xs)
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
