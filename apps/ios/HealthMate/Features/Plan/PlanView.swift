import HealthMateCore
import SwiftUI

/// My Plan (reference: sixth iOS screen). Tasks, medications and habits for a
/// chosen day, with completion tracking and reminders.
struct PlanView: View {
    let store: PlanStore
    /// For profile medications in Medications (nil when signed out or in previews).
    var session: SessionStore?

    @Environment(\.openURL) private var openURL

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
            .navigationDestination(for: UUID.self) { PlanItemDetailView(store: store, itemID: $0) }
            .overlay(alignment: .bottomTrailing) { addButton }
            .overlay(alignment: .bottom) { toast }
            .hmAnimation(HMMotion.spring, value: store.actionError)
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
        HStack(spacing: 12) {
            NavigationLink { PlanOverviewView(store: store) } label: {
                LinkTile(title: "All tasks", subtitle: "Today, coming up, not done", systemImage: "list.bullet.rectangle", tone: .blue)
            }
            NavigationLink { MedicationsView(store: store, session: session) } label: {
                LinkTile(title: "Medications", subtitle: "Plan and profile", systemImage: "pills", tone: .purple)
            }
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))

        SegmentedTabs(items: PlanItemKind.allCases.map { SegmentItem(value: $0, title: $0.title) }, selection: $kind)

        WeekStrip(days: store.week, selection: Binding(get: { store.selectedDay }, set: { store.selectedDay = $0 }), today: store.today, calendar: store.calendar)

        let occurrences = store.occurrences(on: store.selectedDay, kind: filter)
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
        .hmAnimation(HMMotion.spring, value: progress.done)

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
            VStack(alignment: .leading, spacing: 6) {
                Label("Notifications are off, so reminders can't be delivered.", systemImage: "bell.slash")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textPrimary)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .font(.hmCaption.weight(.semibold))
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
        }
    }

    private func row(_ occurrence: PlanOccurrence) -> some View {
        let item = occurrence.item
        let enabled = store.canComplete(occurrence.day)
        return HStack(spacing: 4) {
            TaskRow(
                title: item.title,
                detail: PlanPresenter.detail(item),
                sourceLabel: PlanPresenter.sourceLabel(item),
                time: HealthFormat.clockTime(item.time.hhmm, locale: .current),
                completed: occurrence.completed
            ) { Task { await store.toggle(occurrence) } }
            .opacity(enabled ? 1 : 0.55)
            NavigationLink(value: item.id) {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(HM.Colors.textMuted)
                    .frame(width: 32, height: 44)
            }
            .accessibilityLabel("\(item.title) details")
        }
        .contextMenu {
            Button { editor = EditorTarget(item: item, kind: item.kind) } label: { Label("Edit", systemImage: "pencil") }
            Button(role: .destructive) { pendingDelete = item } label: { Label("Delete", systemImage: "trash") }
        }
        .accessibilityAction(named: "Edit") { editor = EditorTarget(item: item, kind: item.kind) }
        .accessibilityAction(named: "Delete") { pendingDelete = item }
    }

    /// Like the reference, "Tasks" lists everything due; the other tabs narrow it down.
    private var filter: PlanItemKind? { kind == .task ? nil : kind }

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
        case .task: return "Add tasks, medications and habits with the + button."
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

/// A compact card that opens another plan view.
private struct LinkTile: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tone: Tone

    var body: some View {
        HStack(spacing: 10) {
            IconBadge(systemName: systemImage, tone: tone, size: .small, filled: true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text(subtitle).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
    }
}
