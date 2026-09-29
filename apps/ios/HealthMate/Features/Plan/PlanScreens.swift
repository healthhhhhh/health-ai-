import HealthMateCore
import SwiftUI

/// Everything in the plan across days: due earlier today, later, done, coming up and not done this week.
struct PlanOverviewView: View {
    let store: PlanStore

    var body: some View {
        let overview = PlanSchedule.overview(items: store.items, completions: store.completions, today: store.today, now: TimeOfDay(date: Date(), calendar: store.calendar), calendar: store.calendar)
        List {
            if store.items.isEmpty {
                EmptyStateView(systemImage: "checklist", title: "Your plan is empty", message: "Add a task, habit or medication and it will appear here across the week.")
                    .listRowBackground(Color.clear)
            } else {
                Section("Today") {
                    if overview.isTodayEmpty {
                        Text("Nothing planned for today.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    } else if overview.dueEarlier.isEmpty && overview.laterToday.isEmpty {
                        Label("Everything for today is done.", systemImage: "checkmark.circle.fill").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.success)
                    }
                    rows(overview.dueEarlier, badge: (.warning, "Time has passed"))
                    rows(overview.laterToday, badge: (.neutral, "Later today"))
                    rows(overview.doneToday, badge: (.success, "Done"))
                }
                Section {
                    if overview.notDone.isEmpty {
                        Text("Nothing missed in the last 7 days.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                    ForEach(overview.notDone) { occurrence in
                        NavigationLink(value: occurrence.item.id) { row(occurrence, meta: dayName(occurrence.day)) }
                    }
                } header: {
                    Text("Not done this week")
                } footer: {
                    if !overview.notDone.isEmpty { Text("You can still tick these off on their day if you did them.") }
                }
                ForEach(overview.upcoming) { day in
                    Section(dayName(day.day)) {
                        ForEach(day.occurrences) { occurrence in
                            NavigationLink(value: occurrence.item.id) { row(occurrence, meta: nil) }
                        }
                    }
                }
            }
        }
        .navigationTitle("All tasks")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func rows(_ occurrences: [PlanOccurrence], badge: (StatusBadge.Status, String)) -> some View {
        ForEach(occurrences) { occurrence in
            NavigationLink(value: occurrence.item.id) {
                HStack {
                    row(occurrence, meta: nil)
                    Spacer(minLength: 8)
                    StatusBadge(status: badge.0, text: badge.1)
                }
            }
        }
    }

    private func row(_ occurrence: PlanOccurrence, meta: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(occurrence.item.title).font(.hmBodyEmphasis)
            Text([occurrence.item.kind.singular, meta, HealthFormat.clockTime(occurrence.item.time.hhmm, locale: .current)].compactMap { $0 }.joined(separator: " · "))
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func dayName(_ day: DayKey) -> String {
        (day.date(in: store.calendar) ?? Date()).formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }
}

/// Every medication in one place: plan reminders and the health profile, each instruction exactly as entered.
struct MedicationsView: View {
    let store: PlanStore
    var session: SessionStore?

    @State private var profile: [MedicationRecord] = []
    @State private var profileFailed = false
    @State private var addFromProfile: MedicationRecord?

    var body: some View {
        let medications = MedicationList.unify(items: store.items, profile: profile)
        ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.md) {
                if profileFailed {
                    Label("Your profile's medications couldn't load, so only your plan is shown.", systemImage: "wifi.exclamationmark")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.warning)
                }
                if medications.isEmpty {
                    EmptyStateView(systemImage: "pills", title: "No medications yet", message: "Add a medication with its instructions exactly as written on the label or prescription, and get reminders.")
                        .hmCard()
                }
                ForEach(medications) { medication in card(medication) }
                DisclaimerView(text: "Never start, stop or change a medication or dose without talking to your clinician.")
            }
            .padding(HM.Spacing.lg)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Medications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadProfile() }
        .refreshable { await loadProfile() }
        .sheet(item: $addFromProfile) { medication in
            PlanItemEditor(store: store, existing: nil, initialKind: .medication, fromProfile: medication)
        }
    }

    private func card(_ medication: UnifiedMedication) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(medication.name).font(.hmCardTitle)
                if medication.planItem != nil && medication.profile != nil {
                    Text("Also in your profile").font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
                }
            }
            if let source = sourceLabel(medication) {
                Text(source).font(.hmMicro.weight(.semibold)).foregroundStyle(HM.Colors.primary)
            }
            Text("Instructions, exactly as entered").font(.hmMicro.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
            Text(medication.instruction ?? "No instructions saved").font(.hmBody)
            if let item = medication.planItem {
                let stats = PlanSchedule.adherence(item, completions: store.completions, today: store.today, calendar: store.calendar)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(HealthFormat.clockTime(item.time.hhmm, locale: .current)) · \(PlanPresenter.describeRepeat(item.repeatRule, calendar: store.calendar))")
                    Label("Reminder \(item.reminderEnabled ? "on" : "off")", systemImage: item.reminderEnabled ? "bell" : "bell.slash")
                    if stats.scheduled > 0 { Text("Taken on \(stats.done) of \(stats.scheduled) scheduled days this week") }
                }
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
                NavigationLink(value: item.id) { Label("Details", systemImage: "chevron.right") }
                    .font(.hmCaption.weight(.semibold))
            } else if let record = medication.profile {
                Text("In your profile, not in your plan — no reminders.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                Button { addFromProfile = record } label: { Label("Add a reminder", systemImage: "bell") }
                    .buttonStyle(.hmSecondary)
            }
        }
        .padding(HM.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(medication.name)
    }

    private func sourceLabel(_ medication: UnifiedMedication) -> String? {
        if let item = medication.planItem { return PlanPresenter.sourceLabel(item) }
        switch medication.profile?.source {
        case .clinicianProvided: return "From your clinician"
        case .documentExtracted: return "From a report"
        default: return "You added this"
        }
    }

    private func loadProfile() async {
        guard let session, session.isSignedIn else { return }
        do {
            profile = try await session.api.healthProfile().medications
            profileFailed = false
        } catch {
            session.handle(error)
            profileFailed = true
        }
    }
}

/// One task, habit or medication: instructions exactly as entered, schedule, reminder and the last 7 days.
struct PlanItemDetailView: View {
    let store: PlanStore
    let itemID: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var confirmRemove = false

    var body: some View {
        Group {
            if let item = store.items.first(where: { $0.id == itemID }) {
                content(item)
            } else {
                EmptyStateView(systemImage: "checklist", title: "Not in your plan", message: "This item was removed.")
                    .padding(.top, 60)
            }
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ item: PlanItem) -> some View {
        let history = PlanSchedule.history(item, completions: store.completions, today: store.today, calendar: store.calendar)
        let stats = PlanSchedule.adherence(item, completions: store.completions, today: store.today, calendar: store.calendar)
        let today = store.occurrences(on: store.today).first { $0.item.id == item.id }
        let isMedication = item.kind == .medication
        return ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.kind.singular).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                    Text(item.title).font(.hmPageHeading)
                    if let source = PlanPresenter.sourceLabel(item) {
                        Text(source).font(.hmMicro.weight(.semibold)).foregroundStyle(HM.Colors.primary)
                    }
                }
                if isMedication {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Instructions, exactly as entered").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                        Text(item.instruction ?? "No instructions saved").font(.hmSectionHeading)
                        Text("HealthMate shows these word for word and never changes them. Check the label or ask your pharmacist or clinician if anything is unclear.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                    .padding(HM.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hmCard()
                }
                VStack(alignment: .leading, spacing: 10) {
                    Label(HealthFormat.clockTime(item.time.hhmm, locale: .current), systemImage: "clock")
                    Label(PlanPresenter.describeRepeat(item.repeatRule, calendar: store.calendar), systemImage: "calendar")
                    Label(item.reminderEnabled ? "Reminder on" : "Reminder off", systemImage: item.reminderEnabled ? "bell" : "bell.slash")
                    if item.reminderEnabled && store.remindersDenied {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Notifications are off, so this reminder can't be delivered.").font(.hmCaption)
                            Button("Open Settings") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                            }
                            .font(.hmCaption.weight(.semibold))
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
                    }
                    if let notes = item.notes, !notes.isEmpty {
                        Label(notes, systemImage: "note.text")
                    }
                }
                .font(.hmBody)
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Last 7 days").font(.hmCardTitle)
                        Spacer()
                        if stats.scheduled > 0 { Text("\(stats.done) of \(stats.scheduled) done").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary) }
                    }
                    HStack(spacing: 6) {
                        ForEach(history.indices, id: \.self) { index in
                            let entry = history[index]
                            let date = entry.day.date(in: store.calendar) ?? Date()
                            VStack(spacing: 4) {
                                Text(date.formatted(.dateTime.weekday(.narrow))).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
                                Text(date.formatted(.dateTime.day()))
                                    .font(.hmCaption.weight(.semibold))
                                    .frame(width: 34, height: 34)
                                    .foregroundStyle(entry.status == .done ? HM.Colors.success : entry.status == .due ? HM.Colors.primary : HM.Colors.textSecondary)
                                    .background(Circle().fill(entry.status == .done ? HM.Colors.successSoft : entry.status == .due ? HM.Colors.primarySoft : HM.Colors.cardMuted))
                            }
                            .frame(maxWidth: .infinity)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(date.formatted(.dateTime.weekday(.wide).month().day())): \(entry.status.label)")
                        }
                    }
                }
                .padding(HM.Spacing.md)
                .hmCard()

                if let today {
                    Button {
                        Task { await store.toggle(today) }
                    } label: {
                        Label(today.completed ? "Undo today" : isMedication ? "Mark as taken today" : "Mark as done today", systemImage: today.completed ? "arrow.uturn.backward" : "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.hmPrimary(fullWidth: true))
                }
                HStack(spacing: 12) {
                    Button { editing = true } label: { Label("Edit", systemImage: "pencil").frame(maxWidth: .infinity) }
                        .buttonStyle(.hmSecondary)
                    Button(role: .destructive) { confirmRemove = true } label: { Label("Remove", systemImage: "trash").frame(maxWidth: .infinity) }
                        .buttonStyle(.hmSecondary)
                }
                if isMedication {
                    DisclaimerView(text: "Never start, stop or change a medication or dose without talking to your clinician.")
                }
            }
            .padding(HM.Spacing.lg)
        }
        .navigationTitle(item.title)
        .sheet(isPresented: $editing) { PlanItemEditor(store: store, existing: item, initialKind: item.kind) }
        .confirmationDialog("Remove “\(item.title)”?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                Task {
                    await store.delete(item)
                    dismiss()
                }
            }
        } message: {
            Text(isMedication
                ? "This removes the reminder and its history from your plan. It doesn't change your prescription — talk to your clinician before stopping or changing a medication."
                : "This removes it and its history from your plan.")
        }
    }
}
