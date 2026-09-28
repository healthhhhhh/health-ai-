import Charts
import HealthMateCore
import SwiftUI

/// Health tab: Apple Health trends compared with the person's own baseline,
/// plus the health timeline.
struct HealthDashboardView: View {
    let session: SessionStore
    @State private var model: HealthDashboardViewModel
    @State private var confirmDisconnect = false

    init(session: SessionStore, reader: any HealthDataReading) {
        self.session = session
        _model = State(initialValue: HealthDashboardViewModel(reader: reader, api: session.api))
    }

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    switch model.state {
                    case .unavailable:
                        EmptyStateView(systemImage: "heart.slash", tone: .red, title: "Apple Health isn't available", message: "Apple Health isn't available on this device. Your plan and the AI Health Assistant still work.")
                            .hmCard()
                    case .notConnected:
                        ConnectHealthCard { Task { await model.connect() } }
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
                            HealthTimelineView(api: session.api, onSessionEnded: { session.handle($0) })
                        } label: {
                            HStack(spacing: 12) {
                                IconBadge(systemName: "clock.arrow.circlepath", tone: .blue)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Health timeline").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                                    Text("Reports, conversations, symptoms and notes in one place").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(HM.Colors.textMuted)
                            }
                            .padding(HM.Spacing.md)
                            .hmCard()
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
        Picker("Period", selection: $model.periodDays) {
            Text("7 days").tag(7)
            Text("30 days").tag(30)
        }
        .pickerStyle(.segmented)

        if let message = model.lastSyncMessage {
            Label(message, systemImage: model.syncing ? "arrow.triangle.2.circlepath" : "checkmark.circle")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }

        if model.state == .loaded && !model.hasAnyData {
            EmptyStateView(systemImage: "chart.xyaxis.line", tone: .blue, title: "No data yet", message: "We didn't find any steps, heart rate, sleep or weight in Apple Health for this period. If you expected some, check Settings › Health › Data Access › HealthMate.")
                .hmCard()
        } else {
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
    }
}

private struct ConnectHealthCard: View {
    let onConnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                IconBadge(systemName: "heart.fill", tone: .red, size: .large, filled: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Connect Apple Health").font(.hmSectionHeading)
                    Text("See your steps, heart rate, sleep and weight over time.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                point("You choose exactly what to share", systemImage: "hand.tap")
                point("Read-only — HealthMate never writes to Apple Health", systemImage: "eye")
                point("Stays on your phone unless you turn on sync", systemImage: "iphone")
            }
            Button("Connect", action: onConnect).buttonStyle(.hmPrimary(fullWidth: true))
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
                    BarMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, value.value))
                        .foregroundStyle(metric.tone.color.gradient)
                        .cornerRadius(2)
                } else {
                    LineMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, value.value))
                        .foregroundStyle(metric.tone.color)
                        .interpolationMethod(.catmullRom)
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
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
                            BarMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, value.value))
                                .foregroundStyle(metric.tone.color.gradient)
                                .cornerRadius(3)
                        } else {
                            LineMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, value.value))
                                .foregroundStyle(metric.tone.color)
                                .interpolationMethod(.catmullRom)
                            PointMark(x: .value("Day", value.date, unit: .day), y: .value(metric.title, value.value))
                                .foregroundStyle(metric.tone.color)
                        }
                    }
                    if let baseline = summary.baselineAverage, summary.trend != .noBaseline {
                        RuleMark(y: .value("Your usual", baseline))
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
