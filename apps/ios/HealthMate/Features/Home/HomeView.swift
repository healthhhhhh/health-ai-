import HealthMateCore
import SwiftUI

/// Home dashboard (reference: second iOS screen).
struct HomeView: View {
    let model: HomeViewModel
    let plan: PlanStore
    var onAsk: (String) -> Void
    var onNavigate: (AppTab) -> Void
    var onVoice: () -> Void = {}
    /// Signed in to a demo server: account content is seeded demo data.
    var isDemoAccount = false
    var isPreview = false
    /// For screens opened from Home (notifications, appointments, reports, metrics). Nil in previews.
    var session: SessionStore?
    var healthReader: (any HealthDataReading)?
    /// Destinations that live in another tab (chat, plan, profile…).
    var onRoute: (AppRoute) -> Void = { _ in }

    @State private var question = ""
    @State private var path: [AppRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
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
            .animation(HMMotion.spring, value: model.actionError ?? plan.actionError)
            .navigationDestination(for: AppRoute.self) { route in destination(route) }
        }
        // Coming back from notifications or a detail refreshes the unread count and sections.
        .onChange(of: path) { _, newPath in
            if newPath.isEmpty { Task { await model.load() } }
        }
    }

    /// Opens a destination: pushed on Home when it has a screen here, otherwise handed to the tab bar.
    private func open(_ route: AppRoute) {
        guard let session else { return onRoute(route) }
        switch route {
        case .notifications, .appointment, .report, .reports, .timeline:
            path.append(route)
        case .metric where healthReader != nil:
            path.append(route)
        default:
            onRoute(route)
        }
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        if let session {
            switch route {
            case .notifications:
                NotificationsView(model: NotificationsViewModel(api: session.api), onOpen: open)
            case .appointment(let id):
                AppointmentDetailView(api: session.api, appointmentID: id, onAsk: onAsk)
            case .report(let id):
                ReportDestination(session: session, documentID: id)
            case .reports:
                DocumentsView(session: session)
            case .timeline:
                HealthTimelineView(api: session.api, onSessionEnded: { session.handle($0) })
            case .metric(let metric):
                if let healthReader {
                    MetricDestination(metric: metric, reader: healthReader, api: session.api)
                }
            default:
                EmptyView()
            }
        }
    }

    /// Home metric → the matching Health metric, when there's a detail for it.
    private func route(for metric: HealthMetric) -> AppRoute {
        switch metric.kind {
        case .heartRate: .metric(.heartRate)
        case .steps: .metric(.steps)
        case .sleep: .metric(.sleep)
        case .calories: .metric(.activeEnergy)
        case .weight: .metric(.weight)
        default: .health
        }
    }

    @ViewBuilder
    private func content(_ summary: HomeSummary) -> some View {
        VStack(alignment: .leading, spacing: HM.Spacing.xl) {
            VStack(alignment: .leading, spacing: HM.Spacing.md) {
                if isPreview {
                    SampleDataBanner(text: "Preview mode — sample account, not real health data")
                } else if model.isSampleData {
                    SampleDataBanner()
                } else if isDemoAccount {
                    SampleDataBanner(text: "Demo account — example content, not real health data")
                }
                HomeHeader(user: summary.user, unreadNotifications: summary.unreadNotifications) { open(.notifications) }
                AskBar(text: $question, onSubmit: onAsk, onVoice: onVoice)
            }
            .appearAnimation()

            AssistantHeroCard(firstName: summary.user.firstName) { onNavigate(.chat) }
                .appearAnimation(delay: 0.06)

            TodaysHealthGrid(metrics: summary.metrics, onSeeAll: { onNavigate(.health) }, onOpen: { open(route(for: $0)) })
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
                occurrences: plan.occurrences(on: plan.today),
                progress: plan.progress(on: plan.today),
                celebrationCount: plan.celebrationCount,
                onToggle: { occurrence in Task { await plan.toggle(occurrence) } },
                onViewPlan: { onNavigate(.plans) }
            )
            .appearAnimation(delay: 0.35)
            .id("plan")

            AppointmentsCard(appointments: summary.upcomingAppointments) { appointment in
                open(appointment.isCareAppointment ? .appointment(id: appointment.id) : .timeline)
            }
            RecentActivityCard(events: summary.recentActivity) { event in
                open(AppRoute(link: event.link) ?? .timeline)
            }
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
        if let message = model.actionError ?? plan.actionError {
            ToastView(message: message)
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(3))
                    withAnimation(HMMotion.spring) {
                        model.actionError = nil
                        plan.actionError = nil
                    }
                }
        }
    }
}

/// A report or photo opened from Home, with its own list model.
private struct ReportDestination: View {
    let session: SessionStore
    let documentID: String
    @State private var model: DocumentsViewModel
    @State private var loaded = false

    init(session: SessionStore, documentID: String) {
        self.session = session
        self.documentID = documentID
        _model = State(initialValue: DocumentsViewModel(api: session.api, onSessionEnded: { [session] in session.handle($0) }))
    }

    var body: some View {
        Group {
            if loaded {
                DocumentDetailView(model: model, documentID: documentID)
            } else {
                StateView(state: .loading).padding(.top, 60)
            }
        }
        .task {
            await model.load()
            loaded = true
        }
    }
}

/// A metric opened from Home, with the same data and comparison as the Health tab.
private struct MetricDestination: View {
    let metric: TrackedMetric
    @State private var model: HealthDashboardViewModel

    init(metric: TrackedMetric, reader: any HealthDataReading, api: APIClient) {
        self.metric = metric
        _model = State(initialValue: HealthDashboardViewModel(reader: reader, api: api))
    }

    var body: some View {
        MetricDetailView(metric: metric, model: model)
            .navigationTitle(metric.title)
            .task { await model.load() }
    }
}

#Preview("Home") {
    HomeView(
        model: HomeViewModel(service: MockHealthDataService()),
        plan: PlanStore(repository: InMemoryPlanRepository(), reminders: RecordingReminderScheduler()),
        onAsk: { _ in },
        onNavigate: { _ in }
    )
}
