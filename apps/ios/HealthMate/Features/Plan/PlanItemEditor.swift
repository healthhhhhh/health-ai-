import HealthMateCore
import SwiftUI

/// Add / edit sheet for a plan item.
struct PlanItemEditor: View {
    let store: PlanStore
    let existing: PlanItem?

    @Environment(\.dismiss) private var dismiss
    @State private var draft: PlanItemDraft
    @State private var errors = PlanItemDraft.Errors()
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var attemptedSave = false

    init(store: PlanStore, existing: PlanItem?, initialKind: PlanItemKind, fromProfile: MedicationRecord? = nil) {
        self.store = store
        self.existing = existing
        let today = store.today
        var draft = existing.map { PlanItemDraft(editing: $0, today: today) } ?? PlanItemDraft(kind: initialKind, today: today)
        // A reminder for a profile medication starts from its name and instructions exactly as entered.
        if existing == nil, let medication = fromProfile {
            draft.kind = .medication
            draft.title = medication.name
            draft.instruction = medication.instruction
            draft.instructionSource = medication.source == .clinicianProvided ? .clinician : .userOrLabel
        }
        _draft = State(initialValue: draft)
    }

    private var isMedication: Bool { draft.kind == .medication }

    var body: some View {
        NavigationStack {
            Form {
                if existing == nil {
                    Section {
                        Picker("Type", selection: $draft.kind) {
                            ForEach(PlanItemKind.allCases) { Text($0.singular).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }

                Section {
                    TextField(isMedication ? "Medication name" : "Name, e.g. Evening walk", text: $draft.title)
                        .textInputAutocapitalization(.sentences)
                    if let error = errors.title { errorText(error) }
                    if !isMedication {
                        TextField("Details (optional), e.g. 30 minutes", text: $draft.notes)
                    }
                } header: {
                    Text(draft.kind.singular)
                }

                if isMedication {
                    Section {
                        TextField("Exactly as written, e.g. “one tablet after breakfast”", text: $draft.instruction, axis: .vertical)
                            .lineLimit(2...5)
                        if let error = errors.instruction { errorText(error) }
                        Picker("Instruction from", selection: $draft.instructionSource) {
                            ForEach(PlanItemDraft.InstructionSource.allCases) { Text($0.title).tag($0) }
                        }
                    } header: {
                        Text("Instructions")
                    } footer: {
                        Text("HealthMate saves this exactly as you enter it. It never suggests, changes or checks medications or doses — if you're unsure, ask your clinician or pharmacist.")
                    }
                }

                Section("When") {
                    DatePicker("Time", selection: timeBinding, displayedComponents: .hourAndMinute)
                    Picker("Repeat", selection: $draft.repeatKind) {
                        ForEach(PlanItemDraft.RepeatKind.allCases) { Text($0.title).tag($0) }
                    }
                    switch draft.repeatKind {
                    case .weekdays:
                        WeekdayPicker(selection: $draft.weekdays, calendar: store.calendar)
                        if let error = errors.weekdays { errorText(error) }
                    case .once:
                        DatePicker("Date", selection: onceBinding, in: (store.today.date(in: store.calendar) ?? Date())..., displayedComponents: .date)
                    case .daily:
                        EmptyView()
                    }
                }

                Section {
                    Toggle("Remind me", isOn: $draft.reminderEnabled)
                } footer: {
                    if store.remindersDenied && draft.reminderEnabled {
                        Text("Notifications are turned off for HealthMate. Turn them on in Settings to get reminders.")
                    } else {
                        Text("Reminders don't show health details on your lock screen unless you turn that on in Profile.")
                    }
                }

                if let existing {
                    Section {
                        Button("Delete \(existing.kind.singular.lowercased())", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(existing == nil ? "New \(draft.kind.singular.lowercased())" : "Edit \(draft.kind.singular.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(saving)
                }
            }
            .onChange(of: draft) { _, newDraft in
                if attemptedSave { errors = newDraft.validate() }
            }
            .confirmationDialog("Delete this \(draft.kind.singular.lowercased())?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    guard let existing else { return }
                    Task {
                        await store.delete(existing)
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.error, trigger: errors) { _, new in !new.isEmpty }
        }
        .presentationDragIndicator(.visible)
    }

    private func errorText(_ text: String) -> some View {
        Text(text)
            .font(.hmCaption.weight(.medium))
            .foregroundStyle(HM.Colors.error)
    }

    private var timeBinding: Binding<Date> {
        Binding(
            get: {
                store.calendar.date(bySettingHour: draft.time.hour, minute: draft.time.minute, second: 0, of: Date()) ?? Date()
            },
            set: { draft.time = TimeOfDay(date: $0, calendar: store.calendar) }
        )
    }

    private var onceBinding: Binding<Date> {
        Binding(
            get: { draft.onceDay.date(in: store.calendar) ?? Date() },
            set: { draft.onceDay = DayKey(date: $0, calendar: store.calendar) }
        )
    }

    private func save() async {
        attemptedSave = true
        errors = draft.validate()
        guard errors.isEmpty, let item = draft.makeItem(existing: existing, today: store.today, now: Date()) else { return }
        saving = true
        let ok = await store.save(item)
        saving = false
        if ok { dismiss() }
    }
}

/// Seven toggleable weekday chips, ordered from the calendar's first weekday.
struct WeekdayPicker: View {
    @Binding var selection: Set<Int>
    let calendar: Calendar

    private var ordered: [Int] {
        (0..<7).map { (calendar.firstWeekday - 1 + $0) % 7 + 1 }
    }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(ordered, id: \.self) { weekday in
                let on = selection.contains(weekday)
                let symbol = calendar.veryShortWeekdaySymbols[weekday - 1]
                Button {
                    if on { selection.remove(weekday) } else { selection.insert(weekday) }
                } label: {
                    Text(symbol)
                        .font(.hmBodyEmphasis)
                        .foregroundStyle(on ? HM.Colors.onPrimary : HM.Colors.textPrimary)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(on ? HM.Colors.primaryFill : HM.Colors.cardMuted))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(calendar.weekdaySymbols[weekday - 1])
                .accessibilityAddTraits(on ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
            }
        }
        .frame(maxWidth: .infinity)
        .hmAnimation(HMMotion.bouncy, value: selection)
    }
}
