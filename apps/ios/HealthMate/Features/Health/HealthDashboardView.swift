import Charts
import HealthMateCore
import SwiftUI

/// Health tab: Apple Health trends compared with the person's own baseline,
/// plus the health timeline.
struct HealthDashboardView: View {
    /// Re-renders when Settings › Display › Weight changes.
    @AppStorage("hmWeightUnit") private var weightUnit = WeightUnit.kilograms.rawValue
    let session: SessionStore
    let reader: any HealthDataReading
    @State private var model: HealthDashboardViewModel
    @State private var confirmDisconnect = false
    @Environment(\.openURL) private var openURL

    init(session: SessionStore, reader: any HealthDataReading) {
        self.session = session
        self.reader = reader
        _model = State(initialValue: HealthDashboardViewModel(reader: reader, api: session.api))
    }

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    if session.isPreview && model.isConnected {
                        Label("Sample health data in Preview mode — not real readings.", systemImage: "flask")
                            .font(.hmCaption.weight(.medium))
                            .foregroundStyle(HM.Colors.textPrimary)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
                    }
                    switch model.state {
                    case .unavailable:
                        EmptyStateView(systemImage: "heart.slash", tone: .red, title: "Apple Health isn't available", message: "Apple Health isn't available on this device. Your plan and the AI Health Assistant still work.")
                            .hmCard()
                    case .notConnected:
                        ConnectHealthCard(disconnectedAt: model.disconnectedAt) { Task { await model.connect() } }
                    case .denied(let message):
                        PermissionPrimerView(
                            systemImage: "heart.slash",
                            tone: .red,
                            title: "Apple Health access is off",
                            message: "HealthMate can't read your health data right now.",
                            status: .denied,
                            deniedHelp: message
                        ) {
                            HStack {
                                Button("Open Settings") { SystemSettings.open() }.buttonStyle(.hmPrimary)
                                Button("Try again") { Task { await model.connect() } }.buttonStyle(.hmSecondary)
                            }
                        }
                    case .failed(let message):
                        EmptyStateView(systemImage: "exclamationmark.triangle", tone: .orange, title: "Something went wrong", message: message) {
                            Button("Try again") { Task { await model.connect() } }.buttonStyle(.hmPrimary)
                        }
                        .hmCard()
                    case .loading, .loaded:
                        dashboard
                    }

                    if session.isSignedIn {
                        NavigationLink {
                            HealthTimelineView(api: session.api, onSessionEnded: { session.handle($0) }, session: session, reader: reader)
                        } label: {
                            LinkCard(systemImage: "clock.arrow.circlepath", title: "Health timeline", detail: "Reports, conversations, symptoms and notes in one place")
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.98))
                    }
                    DisclaimerView(text: "Trends compare your recent days with your own earlier days. They're context, not a medical assessment.")
                }
                .padding(HM.Spacing.lg)
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("Health")
            .refreshable { await model.load() }
            .toolbar {
                if model.isConnected {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button { openHealthApp() } label: { Label("Add a reading in Apple Health", systemImage: "plus") }
                            if session.isSignedIn && session.hasConsent("health_data_sync") {
                                Button { Task { await model.sync() } } label: { Label("Sync to my account", systemImage: "arrow.triangle.2.circlepath") }
                            }
                            Button(role: .destructive) { confirmDisconnect = true } label: { Label("Disconnect Apple Health", systemImage: "xmark.circle") }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("Apple Health options")
                    }
                }
            }
            .confirmationDialog("Disconnect Apple Health?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { Task { await model.disconnect(removeSyncedData: false) } }
                if session.isSignedIn {
                    Button("Disconnect and delete synced data", role: .destructive) { Task { await model.disconnect(removeSyncedData: true) } }
                }
            } message: {
                Text("HealthMate stops reading your data. To fully revoke access, also turn it off in Settings › Health › Data Access.")
            }
        }
        .task { await model.load() }
        .onChange(of: model.periodDays) { _, _ in Task { await model.load() } }
    }

    @ViewBuilder
    private var dashboard: some View {
        SyncStatusCard(model: model, session: session)

        if model.state == .loaded && !model.hasAnyData {
            EmptyStateView(systemImage: "chart.xyaxis.line", tone: .blue, title: "No data yet", message: "We didn't find any steps, heart rate, sleep or weight in Apple Health for this period. If you expected some, check Settings › Health › Data Access › HealthMate.") {
                Button("Open the Health app") { openHealthApp() }.buttonStyle(.hmSecondary)
            }
            .hmCard()
        } else {
            TodaySnapshot(days: model.days)
                .redacted(reason: model.state == .loading ? .placeholder : [])

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Trends").font(.hmSectionHeading).foregroundStyle(HM.Colors.textPrimary).accessibilityAddTraits(.isHeader)
                    Spacer()
                }
                Picker("Period", selection: $model.periodDays) {
                    ForEach(HealthDashboardViewModel.periods, id: \.self) { Text("\($0) days").tag($0) }
                }
                .pickerStyle(.segmented)
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(TrackedMetric.allCases) { metric in
                        NavigationLink {
                            MetricDetailView(metric: metric, model: model)
                        } label: {
                            MetricTrendCard(metric: metric, values: model.values(metric), summary: model.summary(metric))
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.97))
                    }
                }
                .redacted(reason: model.state == .loading ? .placeholder : [])
            }

            NavigationLink {
                HealthHistoryView(reader: reader, isPreview: session.isPreview)
            } label: {
                LinkCard(systemImage: "calendar", title: "Daily health history", detail: "Every day you record is kept as part of your health history")
            }
            .buttonStyle(PressableButtonStyle(scale: 0.98))
        }
    }

    private func openHealthApp() {
        if let url = URL(string: "x-apple-health://") { openURL(url) }
    }
}

/// A tappable row card leading to another screen.
private struct LinkCard: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: systemImage, tone: .blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(HM.Colors.textMuted)
        }
        .padding(HM.Spacing.md)
        .hmCard()
    }
}

/// Apple Health is read on this iPhone; syncing copies completed days to the account.
private struct SyncStatusCard: View {
    let model: HealthDashboardViewModel
    let session: SessionStore

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: icon, tone: tone)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
                if case .failed = model.syncStatus {
                    Button("Try again") { Task { await model.sync() } }
                        .font(.hmCaption.weight(.semibold))
                        .padding(.top, 2)
                } else if canSync, !model.syncing {
                    Button("Sync now") { Task { await model.sync() } }
                        .font(.hmCaption.weight(.semibold))
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
            if model.syncing { ProgressView().accessibilityLabel("Syncing") }
        }
        .padding(14)
        .hmCard()
        .accessibilityElement(children: .contain)
    }

    private var canSync: Bool { session.isSignedIn && session.hasConsent("health_data_sync") }

    private var icon: String {
        switch model.syncStatus {
        case .syncing: "arrow.triangle.2.circlepath"
        case .failed: "exclamationmark.icloud"
        default: canSync ? "checkmark.icloud" : "iphone"
        }
    }

    private var tone: Tone {
        switch model.syncStatus {
        case .failed: .orange
        case .syncing: .blue
        default: canSync ? .green : .blue
        }
    }

    private var title: String {
        switch model.syncStatus {
        case .syncing: "Syncing to your account…"
        case .failed: "Sync didn't complete"
        default: "Apple Health connected"
        }
    }

    private var detail: String {
        switch model.syncStatus {
        case .syncing: return "Copying completed days to your health history."
        case .failed(let message): return message
        case .succeeded(let message): return "\(message)\(lastSynced)"
        case .idle:
            if !session.isSignedIn { return "Readings stay on this iPhone. Sign in to keep them in your health history." }
            if !canSync { return "Readings stay on this iPhone. Turn on Health data sync in Profile › Privacy to keep them in your health history." }
            return model.lastSyncedAt == nil ? "Not synced to your account yet." : "Up to date\(lastSynced)"
        }
    }

    private var lastSynced: String {
        guard let date = model.lastSyncedAt else { return "" }
        return " · Last synced \(date.formatted(.relative(presentation: .named)))"
    }
}

/// Today's readings next to the person's usual (from the loaded days).
private struct TodaySnapshot: View {
    let days: [HealthDay]
    private let metrics: [TrackedMetric] = [.sleep, .steps, .restingHeartRate, .activeEnergy, .weight]
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Today").font(.hmSectionHeading).foregroundStyle(HM.Colors.textPrimary).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(metrics) { metric in
                    tile(metric)
                }
            }
        }
    }

    private func tile(_ metric: TrackedMetric) -> some View {
        let today = days.first
        let value = today?.values[metric]
        let comparison = today.map { HealthHistory.compare(days, date: $0.date, metric: metric).trend } ?? .noBaseline
        let context = value == nil ? "Not recorded yet" : (metric == .steps || metric == .activeEnergy) ? "So far today" : MetricPresenter.trendLabel(comparison)
        return VStack(alignment: .leading, spacing: 4) {
            Label(metric == .sleep ? "Sleep last night" : metric.title, systemImage: metric.symbol)
                .font(.hmCaption.weight(.semibold))
                .foregroundStyle(metric.tone.color)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value.map(metric.format) ?? "—").font(.hmMetric).foregroundStyle(HM.Colors.textPrimary)
                if value != nil, let unit = metric.displayUnit { Text(unit).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary) }
            }
            Text(context).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
        .accessibilityElement(children: .combine)
    }
}

extension TrackedMetric {
    /// SF Symbol for the metric.
    var symbol: String {
        switch self {
        case .steps: "figure.walk"
        case .heartRate: "heart.fill"
        case .restingHeartRate: "waveform.path.ecg"
        case .sleep: "moon.zzz.fill"
        case .activeEnergy: "flame.fill"
        case .weight: "scalemass.fill"
        }
    }
}

private struct ConnectHealthCard: View {
    var disconnectedAt: Date?
    let onConnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                IconBadge(systemName: "heart.fill", tone: .red, size: .large, filled: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(disconnectedAt == nil ? "Connect Apple Health" : "Apple Health is disconnected").font(.hmSectionHeading)
                    Text(disconnectedAt.map { "You disconnected \($0.formatted(.relative(presentation: .named))). Readings already in your history stay there." } ?? "See your steps, heart rate, sleep and weight over time.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                point("You choose exactly what to share", systemImage: "hand.tap")
                point("Read-only — HealthMate never writes to Apple Health", systemImage: "eye")
                point("Stays on your phone unless you turn on sync", systemImage: "iphone")
            }
            Button(disconnectedAt == nil ? "Connect" : "Reconnect", action: onConnect).buttonStyle(.hmPrimary(fullWidth: true))
        }
        .padding(HM.Spacing.lg)
        .hmCard()
        .appearAnimation()
    }

    private func point(_ text: String, systemImage: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(HM.Colors.primary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text).foregroundStyle(HM.Colors.textPrimary)
        }
        .font(.hmCaption)
    }
}

private struct MetricTrendCard: View {
    let metric: TrackedMetric
    let values: [DailyValue]
    let summary: TrendSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(metric.title).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
            if let average = summary.average {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(metric.format(average)).font(.hmMetric).foregroundStyle(HM.Colors.textPrimary)
                    if let unit = metric.displayUnit { Text(unit).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary) }
                }
                Text(metric.isCumulative ? "Daily average" : "Average").font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
            } else {
                Text("—").font(.hmMetric).foregroundStyle(HM.Colors.textMuted)
                Text("No data").font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
            }
            Chart(values) { value in
                if metric.isCumulative {
                    BarMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, metric.displayValue(value.value)))
                        .foregroundStyle(metric.tone.color.gradient)
                        .cornerRadius(2)
                } else {
                    LineMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, metric.displayValue(value.value)))
                        .foregroundStyle(metric.tone.color)
                        .interpolationMethod(.catmullRom)
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: .automatic(includesZero: metric.isCumulative))
            .frame(height: 44)
            .accessibilityHidden(true)
            Text(MetricPresenter.trendLabel(summary.trend))
                .font(.hmMicro)
                .foregroundStyle(summary.trend == .inUsualRange ? HM.Colors.success : HM.Colors.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(metric.title): \(summary.average.map { metric.format($0) + " " + (metric.displayUnit ?? "") } ?? "no data"). \(MetricPresenter.trendLabel(summary.trend))")
    }
}

/// One metric in detail with axes, the average line and the baseline comparison.
struct MetricDetailView: View {
    /// Re-renders when Settings › Display › Weight changes.
    @AppStorage("hmWeightUnit") private var weightUnit = WeightUnit.kilograms.rawValue
    let metric: TrackedMetric
    let model: HealthDashboardViewModel
    @State private var selectedDate: Date?

    private var values: [DailyValue] { model.values(metric) }
    private var summary: TrendSummary { model.summary(metric) }
    private var selected: DailyValue? {
        guard let selectedDate else { return nil }
        return values.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                VStack(alignment: .leading, spacing: 4) {
                    if let selected {
                        Text(selected.date, format: .dateTime.weekday(.wide).day().month())
                            .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        valueText(selected.value)
                    } else {
                        Text("Last \(model.periodDays) days · \(metric.isCumulative ? "daily average" : "average")")
                            .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        if let average = summary.average { valueText(average) } else { Text("No data").font(.hmMetric) }
                    }
                }
                .accessibilityElement(children: .combine)

                Chart {
                    ForEach(values) { value in
                        if metric.isCumulative {
                            BarMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, metric.displayValue(value.value)))
                                .foregroundStyle(metric.tone.color.gradient)
                                .cornerRadius(3)
                        } else {
                            LineMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, metric.displayValue(value.value)))
                                .foregroundStyle(metric.tone.color)
                                .interpolationMethod(.catmullRom)
                            PointMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, metric.displayValue(value.value)))
                                .foregroundStyle(metric.tone.color)
                        }
                    }
                    if let baseline = summary.baselineAverage, summary.trend != .noBaseline {
                        RuleMark(y: .value("Your usual", metric.displayValue(baseline)))
                            .foregroundStyle(HM.Colors.textMuted)
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .annotation(position: .top, alignment: .leading) {
                                Text("Your usual").font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
                            }
                    }
                    if let selected {
                        RuleMark(x: .value("Selected", selected.date, unit: .day))
                            .foregroundStyle(HM.Colors.separator)
                    }
                }
                .chartXSelection(value: $selectedDate)
                .chartYScale(domain: .automatic(includesZero: metric.isCumulative))
                .frame(height: 240)
                // Swift Charts provides VoiceOver values and Audio Graphs automatically.

                VStack(alignment: .leading, spacing: 6) {
                    Label(MetricPresenter.trendLabel(summary.trend), systemImage: "arrow.left.arrow.right")
                        .font(.hmCardTitle)
                    Text(explanation).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()

                VStack(alignment: .leading, spacing: 0) {
                    Text("Day by day").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary).padding(.bottom, 6).accessibilityAddTraits(.isHeader)
                    ForEach(values.reversed()) { value in
                        HStack {
                            Text(value.date, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day())
                                .font(.hmBody)
                                .foregroundStyle(HM.Colors.textPrimary)
                            Spacer()
                            Text(metric.format(value.value) + (metric.displayUnit.map { " \($0)" } ?? ""))
                                .font(.hmBodyEmphasis)
                                .monospacedDigit()
                                .foregroundStyle(HM.Colors.textPrimary)
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                        Divider()
                    }
                }
                .padding(HM.Spacing.md)
                .hmCard()

                Text("Source: Apple Health").font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
            }
            .padding(HM.Spacing.lg)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle(metric.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func valueText(_ value: Double) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(metric.format(value)).font(.system(.largeTitle, design: .rounded, weight: .bold))
            if let unit = metric.displayUnit { Text(unit).font(.hmBody).foregroundStyle(HM.Colors.textSecondary) }
        }
    }

    private var explanation: String {
        switch summary.trend {
        case .noBaseline:
            return "We need at least \(TrendAnalysis.minimumBaselineDays) days of earlier data to compare with your usual pattern."
        default:
            let baseline = summary.baselineAverage.map { metric.format($0) + (metric.displayUnit.map { " \($0)" } ?? "") } ?? "—"
            return "Compared with the \(model.periodDays) days before, when your average was \(baseline). If something feels off, talk to a clinician."
        }
    }
}
