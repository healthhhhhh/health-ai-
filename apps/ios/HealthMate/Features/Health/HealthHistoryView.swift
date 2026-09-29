import HealthMateCore
import SwiftUI

/// The person's longitudinal record: one row per day, grouped by month.
/// (Phase 1: Apple Health sample data in Preview mode; Phase 2 adds the stored history.)
struct HealthHistoryView: View {
    let reader: any HealthDataReading
    var isPreview = false
    @State private var model: HealthHistoryViewModel

    init(reader: any HealthDataReading, isPreview: Bool = false) {
        self.reader = reader
        self.isPreview = isPreview
        _model = State(initialValue: HealthHistoryViewModel(reader: reader))
    }

    private var months: [(title: String, days: [HealthDay])] {
        var groups: [(title: String, days: [HealthDay])] = []
        for day in model.shown() {
            let title = day.date.formatted(.dateTime.month(.wide).year())
            if groups.last?.title == title { groups[groups.count - 1].days.append(day) } else { groups.append((title, [day])) }
        }
        return groups
    }

    var body: some View {
        List {
            if isPreview {
                Label("Sample health history in Preview mode — not real readings.", systemImage: "flask")
                    .font(.hmCaption.weight(.medium))
                    .listRowBackground(HM.Colors.warningSoft)
            }
            if let state = model.state {
                StateView(
                    state: state,
                    title: state == .empty ? "No days recorded yet" : state == .permission ? "Apple Health access is off" : nil,
                    message: state == .empty ? "When Apple Health has readings, each day is saved here." : state == .permission ? "Turn on access in Settings › Health › Data Access & Devices." : nil
                )
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else {
                ForEach(months, id: \.title) { month in
                    Section(month.title) {
                        ForEach(month.days) { day in
                            NavigationLink {
                                HealthDayView(date: day.date, days: model.days)
                            } label: {
                                DayRow(day: day, isToday: day.id == model.days.first?.id)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Daily history")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
    }
}

private struct DayRow: View {
    let day: HealthDay
    let isToday: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(isToday ? "Today" : day.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .font(.hmBodyEmphasis)
                    .foregroundStyle(HM.Colors.textPrimary)
                if isToday { Text("In progress").font(.hmMicro).foregroundStyle(HM.Colors.textSecondary) }
            }
            HStack(spacing: 12) {
                value(.sleep)
                value(.steps)
                value(.restingHeartRate)
                value(.weight)
            }
            .font(.hmCaption)
            .foregroundStyle(HM.Colors.textSecondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func value(_ metric: TrackedMetric) -> some View {
        if let value = day.values[metric] {
            Label(metric.format(value) + (metric.displayUnit.map { " \($0)" } ?? ""), systemImage: metric.symbol)
                .labelStyle(.titleAndIcon)
                .monospacedDigit()
        }
    }
}

/// One day of the history, each reading next to the person's own usual.
struct HealthDayView: View {
    @State var date: Date
    let days: [HealthDay]

    private var day: HealthDay? { days.first { $0.date == date } }
    private var previous: Date? { days.first { $0.date < date }?.date }
    private var next: Date? { days.last { $0.date > date }?.date }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.md) {
                if let day {
                    ForEach(HealthHistory.metrics) { metric in
                        row(metric, day: day)
                    }
                } else {
                    StateView(state: .empty, title: "No readings on this day", message: "Apple Health didn't have anything for this day.")
                }
                DisclaimerView(text: "“Your usual” is your own average over the 30 days before. It describes your pattern, not a medical assessment.")
            }
            .padding(HM.Spacing.lg)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    if let previous { date = previous }
                } label: {
                    Label("Previous day", systemImage: "chevron.left")
                }
                .disabled(previous == nil)
                Spacer()
                Button {
                    if let next { date = next }
                } label: {
                    Label("Next day", systemImage: "chevron.right")
                }
                .disabled(next == nil)
            }
        }
    }

    private func row(_ metric: TrackedMetric, day: HealthDay) -> some View {
        let value = day.values[metric]
        let comparison = HealthHistory.compare(days, date: date, metric: metric)
        return HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: metric.symbol, tone: metric.tone)
            VStack(alignment: .leading, spacing: 3) {
                Text(metric.title).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value.map(metric.format) ?? "—").font(.hmMetric).foregroundStyle(HM.Colors.textPrimary)
                    if value != nil, let unit = metric.displayUnit { Text(unit).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary) }
                }
                if value == nil {
                    Text("Not recorded this day").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                } else {
                    Text(MetricPresenter.trendLabel(comparison.trend)).font(.hmCaption.weight(.semibold)).foregroundStyle(comparison.trend == .inUsualRange ? HM.Colors.success : HM.Colors.textSecondary)
                    if let usual = comparison.usual {
                        Text("Your usual \(metric.format(usual))\(metric.displayUnit.map { " \($0)" } ?? "")").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .hmCard()
        .accessibilityElement(children: .combine)
    }
}
