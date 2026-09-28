import HealthMateCore
import SwiftUI

/// My Plan (reference: sixth iOS screen). Tasks, medications and habits for a
/// chosen day, with completion tracking and reminders.
struct PlanView: View {
    let store: PlanStore

    @State private var kind: PlanItemKind = .task
    @State private var editor: EditorTarget?
    @State private var pendingDelete: PlanItem?

    /// Sheet target: a new item of a kind, or an existing item.
    struct EditorTarget: Identifiable {
        let item: PlanItem?
        let kind: PlanItemKind
        var id: String { item?.id.uuidString ?? "new-\(kind.rawValue)" }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    switch store.state {
                    case .failed(let message):
                        EmptyStateView(systemImage: "exclamationmark.triangle", tone: .orange, title: "Plan unavailable", message: message) {
                            Button("Try again") { Task { await store.load() } }.buttonStyle(.hmPrimary)
                        }
                    default:
                        content
                    }
                }
                .padding(.horizontal, HM.Spacing.lg)
                .padding(.top, HM.Spacing.xs)
                .padding(.bottom, 96)
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("My Plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if store.containsSampleItems {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Remove sample items", role: .destructive) { Task { await store.removeSampleItems() } }
                        } label: {
                            Image(systemName: "ellipsis.circle").accessibilityLabel("More")
                        }
                    }
                }
            }
            .overlay(alignment: .bottomTrailing) { addButton }
            .overlay(alignment: .bottom) { toast }
            .animation(HMMotion.spring, value: store.actionError)
            .task {
                await store.loadIfNeeded()
                #if DEBUG
                // `-hmShowAddPlan YES` opens the add sheet so CI can screenshot it.
                if UserDefaults.standard.bool(forKey: "hmShowAddPlan") { editor = EditorTarget(item: nil, kind: .medication) }
                #endif
            }
            .sheet(item: $editor) { target in
                PlanItemEditor(store: store, existing: target.item, initialKind: target.kind)
            }
            .confirmationDialog(
                "Delete “\(pendingDelete?.title ?? "")”?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let item = pendingDelete { Task { await store.delete(item) } }
                }
            } message: {
                Text("Its reminders and completion history will be removed.")
            }
        }
    }

    @ViewBuilder private var content: some View {
        SegmentedTabs(items: PlanItemKind.allCases.map { SegmentItem(value: $0, title: $0.title) }, selection: $kind)

        WeekStrip(days: store.week, selection: Binding(get: { store.selectedDay }, set: { store.selectedDay = $0 }), today: store.today, calendar: store.calendar)

        let occurrences = store.occurrences(on: store.selectedDay, kind: kind)
        let progress = PlanSchedule.progress(occurrences)

        VStack(alignment: .leading, spacing: 8) {
            Text(heading)
                .font(.hmSectionHeading)
                .foregroundStyle(HM.Colors.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if progress.total > 0 {
                HStack {
                    Text("\(progress.done) of \(progress.total) completed")
                        .font(.hmCaption.weight(.semibold))
                        .foregroundStyle(HM.Colors.success)
                        .contentTransition(.numericText())
                    Spacer()
                    CelebrationBurst(trigger: store.celebrationCount)
                }
                HMProgressBar(value: progress.ratio, label: "\(kind.title) completed")
            }
        }
        .animation(HMMotion.spring, value: progress.done)

        if store.state == .loading && store.items.isEmpty {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        } else if occurrences.isEmpty {
            EmptyStateView(systemImage: emptyIcon, tone: .blue, title: "Nothing here for this day", message: emptyMessage) {
                Button("Add \(kind.singular.lowercased())") { editor = EditorTarget(item: nil, kind: kind) }
                    .buttonStyle(.hmSecondary)
            }
            .hmCard()
        } else {
            VStack(spacing: 0) {
                ForEach(occurrences) { occurrence in
                    row(occurrence)
                    if occurrence.id != occurrences.last?.id { Divider().overlay(HM.Colors.separator) }
                }
            }
            .hmCard(padding: 14)
        }

        if kind == .medication {
            DisclaimerView(text: "HealthMate records medications exactly as your clinician or the label gives them. It never suggests, changes or checks doses — ask your clinician or pharmacist.")
        }
        if store.remindersDenied {
            Label("Notifications are off, so reminders can't be delivered. You can turn them on in Settings.", systemImage: "bell.slash")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.warning)
        }
    }

    private func row(_ occurrence: PlanOccurrence) -> some View {
        let item = occurrence.item
        let enabled = store.canComplete(occurrence.day)
        return TaskRow(
            title: item.title,
            detail: PlanPresenter.detail(item),
            sourceLabel: PlanPresenter.sourceLabel(item),
            time: HealthFormat.clockTime(item.time.hhmm, locale: .current),
            completed: occurrence.completed
        ) { Task { await store.toggle(occurrence) } }
        .opacity(enabled ? 1 : 0.55)
        .contextMenu {
            Button { editor = EditorTarget(item: item, kind: item.kind) } label: { Label("Edit", systemImage: "pencil") }
            Button(role: .destructive) { pendingDelete = item } label: { Label("Delete", systemImage: "trash") }
        }
        .accessibilityAction(named: "Edit") { editor = EditorTarget(item: item, kind: item.kind) }
        .accessibilityAction(named: "Delete") { pendingDelete = item }
    }

    private var heading: String {
        if store.selectedDay == store.today { return "Today's \(kind.title)" }
        let date = store.selectedDay.date(in: store.calendar) ?? Date()
        return "\(kind.title) · \(date.formatted(.dateTime.weekday(.abbreviated).day()))"
    }

    private var emptyIcon: String {
        switch kind {
        case .task: return "checklist"
        case .medication: return "pills"
        case .habit: return "leaf"
        }
    }

    private var emptyMessage: String {
        switch kind {
        case .task: return "Add things you want to do, like logging a reading."
        case .medication: return "Add medications exactly as your clinician prescribed them, and get reminders."
        case .habit: return "Build routines like drinking water or an evening walk."
        }
    }

    private var addButton: some View {
        Button {
            editor = EditorTarget(item: nil, kind: kind)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(HM.Colors.onPrimary)
                .frame(width: 58, height: 58)
                .background(Circle().fill(HM.Colors.primaryFill).hmShadow(HM.Shadow.raised))
        }
        .buttonStyle(PressableButtonStyle(scale: 0.9))
        .padding(.trailing, HM.Spacing.lg)
        .padding(.bottom, HM.Spacing.md)
        .accessibilityLabel("Add \(kind.singular.lowercased())")
    }

    @ViewBuilder private var toast: some View {
        if let message = store.actionError {
            ToastView(message: message)
                .padding(.bottom, 90)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(3))
                    store.actionError = nil
                }
        }
    }
}
