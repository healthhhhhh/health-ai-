import HealthMateCore
import SwiftUI

/// Add a condition, allergy or medication in the person's own words.
struct AddProfileItemView: View {
    let kind: ProfileView.AddKind
    let model: ProfileViewModel

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var detail = ""
    @State private var fromClinician = true
    @State private var saving = false

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedDetail: String { detail.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !trimmedName.isEmpty && (kind != .medication || !trimmedDetail.isEmpty) && !saving }

    var body: some View {
        NavigationStack {
            Form {
                switch kind {
                case .condition:
                    Section {
                        TextField("e.g. Asthma", text: $name)
                    } header: { Text("Condition") } footer: {
                        Text("Add conditions you've been diagnosed with. The AI Health Assistant uses them for context and never adds conditions itself.")
                    }
                case .allergy:
                    Section("Allergy") {
                        TextField("Substance, e.g. Penicillin", text: $name)
                        TextField("Reaction (optional)", text: $detail)
                    }
                case .medication:
                    Section("Medication") {
                        TextField("Name, e.g. Metformin", text: $name)
                    }
                    Section {
                        TextField("e.g. 500 mg twice a day with food", text: $detail, axis: .vertical)
                            .lineLimit(2...5)
                        Toggle("These are my clinician's instructions", isOn: $fromClinician)
                    } header: {
                        Text("Instructions")
                    } footer: {
                        Text("Copy the instructions exactly from your prescription or pharmacy label. HealthMate stores them word for word and will never suggest changing a medication or dose.")
                    }
                }
                if let error = model.errorMessage {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(!canSave)
                }
            }
        }
    }

    private var title: String {
        switch kind {
        case .condition: return "Add condition"
        case .allergy: return "Add allergy"
        case .medication: return "Add medication"
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let ok: Bool
        switch kind {
        case .condition: ok = await model.addCondition(trimmedName)
        case .allergy: ok = await model.addAllergy(trimmedName, reaction: trimmedDetail.isEmpty ? nil : trimmedDetail)
        // Only surrounding whitespace is removed; the wording itself is kept exactly.
        case .medication: ok = await model.addMedication(trimmedName, instruction: trimmedDetail, fromClinician: fromClinician)
        }
        if ok { dismiss() }
    }
}

/// Permanent deletion, confirmed with the account password.
struct DeleteAccountView: View {
    let session: SessionStore

    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmed = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label {
                        Text("This permanently deletes your account, health profile, memories, conversations, reports and synced health data. It can't be undone.")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(HM.Colors.error)
                    }
                    .font(.hmBody)
                    Text("Your plan and reminders on this device are not affected.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                Section("Confirm with your password") {
                    SecureField("Password", text: $password).textContentType(.password)
                    Toggle("I understand this can't be undone", isOn: $confirmed)
                }
                if let error = session.errorMessage {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error) }
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            if await session.deleteAccount(password: password) { dismiss() }
                        }
                    } label: {
                        HStack {
                            Text("Delete everything")
                            Spacer()
                            if session.busy { ProgressView() }
                        }
                    }
                    .disabled(password.isEmpty || !confirmed || session.busy)
                }
            }
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { session.errorMessage = nil }
        }
    }
}

/// Everything the assistant remembers, labelled by where it came from.
/// AI-inferred facts are marked unconfirmed until the person confirms them.
struct MemoryListView: View {
    let model: ProfileViewModel

    @State private var query = ""
    @State private var results: [MemoryRecord]?
    @State private var editing: MemoryRecord?
    @State private var showAdd = false

    private var shown: [MemoryRecord] { results ?? model.memories }

    var body: some View {
        List {
            if shown.isEmpty {
                EmptyStateView(
                    systemImage: "brain.head.profile",
                    tone: .purple,
                    title: query.isEmpty ? "Nothing remembered yet" : "No matches",
                    message: query.isEmpty ? "When you tap Remember on a suggestion in chat, or add something here, it appears in this list." : "Try a different word."
                )
                .listRowBackground(Color.clear)
            }
            ForEach(shown) { memory in
                Button { editing = memory } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(memory.fact).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                        HStack(spacing: 6) {
                            StatusBadge(status: memory.status == .aiInferred ? .warning : .neutral, text: memory.status.label)
                            Text(memory.createdAt, format: .dateTime.day().month().year())
                                .font(.hmMicro)
                                .foregroundStyle(HM.Colors.textMuted)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .accessibilityHint("Edit or confirm")
            }
            .onDelete { offsets in
                let targets = offsets.map { shown[$0] }
                Task {
                    for memory in targets { await model.deleteMemory(memory) }
                    results = nil
                }
            }
        }
        .navigationTitle("Health memory")
        .searchable(text: $query, prompt: "Search memories")
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = query.isEmpty ? nil : await model.searchMemories(query)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add memory")
            }
        }
        .sheet(item: $editing) { memory in
            MemoryEditor(title: "Edit memory", initial: memory.fact, note: memory.status == .aiInferred ? "Saving confirms this fact as correct." : nil) { fact in
                await model.updateMemory(memory, fact: fact)
            }
        }
        .sheet(isPresented: $showAdd) {
            MemoryEditor(title: "Add memory", initial: "", note: "Something you'd like the assistant to keep in mind, like \"I work night shifts\".") { fact in
                await model.addMemory(fact)
            }
        }
    }
}

private struct MemoryEditor: View {
    let title: String
    let initial: String
    let note: String?
    let onSave: (String) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Fact", text: $text, axis: .vertical).lineLimit(2...6)
                } footer: {
                    if let note { Text(note) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            if await onSave(text.trimmingCharacters(in: .whitespacesAndNewlines)) { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                }
            }
            .onAppear { text = initial }
        }
        .presentationDetents([.medium])
    }
}
