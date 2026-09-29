import HealthMateCore
import SwiftUI

/// First-run setup after creating an account: about you, goals, optional
/// health details, privacy choices, reminders and Apple Health. Nothing is
/// saved until the last step. Mirrors the web `/onboarding` wizard.
struct AccountSetupView: View {
    let session: SessionStore
    let reminders: any ReminderScheduling
    let healthReader: any HealthDataReading

    @State private var step: AccountSetupStep = .about
    @State private var draft = AccountSetupDraft()
    @State private var loaded = false
    /// The account's current details are in the draft (Continue waits for this).
    @State private var ready = false
    @State private var problem: String?
    @State private var notificationStatus: PermissionStatus = .prompt
    @State private var healthStatus: PermissionStatus = .prompt
    @State private var healthMessage: String?
    @AccessibilityFocusState private var headingFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if step != .done { progress }
                    Text(step == .done ? doneTitle : step.title)
                        .font(.hmPageHeading)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($headingFocused)
                    content
                    if let message = problem ?? session.errorMessage {
                        Label(message, systemImage: "exclamationmark.circle.fill")
                            .font(.hmCaption.weight(.medium))
                            .foregroundStyle(HM.Colors.error)
                    }
                }
                .padding(24)
                .id(step)
                .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            }
            .scrollDismissesKeyboard(.interactively)
            .background(HMGradient.appBackground.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { actions }
            .toolbar {
                if let previous = step.previous {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            go(to: previous)
                        } label: {
                            Label("Back", systemImage: "chevron.left")
                        }
                        .disabled(session.busy)
                    }
                }
                if step.isOptional {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Skip") { advance(validating: false) }
                    }
                }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            let profile = try? await session.api.healthProfile()
            let consents = (try? await session.api.consents()) ?? []
            draft = AccountSetupDraft(profile: profile?.profile, consents: Dictionary(uniqueKeysWithValues: consents.map { ($0.kind, $0.granted) }))
            ready = true
            notificationStatus = Self.status(await reminders.authorization())
            if !healthReader.isAvailable { healthStatus = .unavailable }
        }
    }

    private var doneTitle: String {
        let name = draft.firstName.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "You're all set" : "You're all set, \(name)"
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Step \(step.rawValue + 1) of \(AccountSetupStep.countedSteps)")
                Spacer()
                if step.isOptional { Text("Optional").fontWeight(.semibold) }
            }
            .font(.hmCaption)
            .foregroundStyle(HM.Colors.textSecondary)
            ProgressView(value: Double(step.rawValue + 1), total: Double(AccountSetupStep.countedSteps))
                .tint(HM.Colors.primary)
                .accessibilityLabel("Setup progress")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .about: aboutStep
        case .goals: goalsStep
        case .health: AccountSetupHealthStep(draft: $draft)
        case .privacy: privacyStep
        case .reminders: remindersStep
        case .appleHealth: appleHealthStep
        case .done: summary
        }
    }

    // MARK: Steps

    private var aboutStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("This helps the assistant speak to you personally. Only your first name is needed.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            SetupField(label: "First name") {
                TextField("First name", text: $draft.firstName).textContentType(.givenName)
            }
            SetupField(label: "Last name (optional)") {
                TextField("Last name", text: $draft.lastName).textContentType(.familyName)
            }
            Toggle("Add date of birth", isOn: Binding(
                get: { draft.dateOfBirth != nil },
                set: { draft.dateOfBirth = $0 ? (draft.dateOfBirth ?? Calendar.current.date(byAdding: .year, value: -30, to: Date())) : nil }
            ))
            .font(.hmBody)
            if let dateOfBirth = draft.dateOfBirth {
                DatePicker("Date of birth", selection: Binding(get: { dateOfBirth }, set: { draft.dateOfBirth = $0 }), in: ...Date(), displayedComponents: .date)
                    .font(.hmBody)
            }
            Picker("Sex (optional)", selection: Binding(get: { draft.sex ?? "" }, set: { draft.sex = $0.isEmpty ? nil : $0 })) {
                Text("Not set").tag("")
                ForEach(AccountSetupDraft.sexOptions.indices, id: \.self) { index in
                    Text(AccountSetupDraft.sexOptions[index].label).tag(AccountSetupDraft.sexOptions[index].value)
                }
            }
            .font(.hmBody)
            Text("Age and sex are used only to give context to readings and reports.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
    }

    private var goalsStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose any that apply. We'll shape your Home screen and suggestions around them.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            ForEach(HealthGoal.all) { goal in
                let selected = draft.goals.contains(goal.id)
                Button {
                    if selected { draft.goals.remove(goal.id) } else { draft.goals.insert(goal.id) }
                } label: {
                    HStack(spacing: 12) {
                        IconBadge(systemName: goal.systemImage, tone: .blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(goal.label).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                            Text(goal.description).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                        Spacer()
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(selected ? HM.Colors.primary : HM.Colors.separator)
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(selected ? HM.Colors.primarySoft : HM.Colors.card))
                    .overlay(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).strokeBorder(selected ? HM.Colors.primary : HM.Colors.separator, lineWidth: selected ? 2 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .sensoryFeedback(.selection, trigger: selected)
            }
        }
    }

    private struct ConsentCopy: Identifiable {
        let kind: String
        let title: String
        let detail: String
        var id: String { kind }
    }

    private static let consentCopy = [
        ConsentCopy(kind: "ai_processing", title: "AI Health Assistant", detail: "Lets the assistant use what you share in chat to answer. Needed for AI chat."),
        ConsentCopy(kind: "document_processing", title: "Report and photo analysis", detail: "Lets HealthMate read reports and photos you upload to explain them in plain language."),
        ConsentCopy(kind: "health_data_sync", title: "Health data sync", detail: "Lets HealthMate store readings from Apple Health or that you add yourself."),
        ConsentCopy(kind: "voice", title: "Voice input", detail: "Lets you speak to the assistant. Audio is transcribed and not kept."),
    ]

    private var privacyStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Each is off until you turn it on, and you can change them any time in Profile › Privacy & data.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            VStack(spacing: 0) {
                ForEach(Self.consentCopy) { item in
                    Toggle(isOn: Binding(get: { draft.consents[item.kind] == true }, set: { draft.consents[item.kind] = $0 })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                            Text(item.detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                    }
                    .padding(.vertical, 10)
                    if item.kind != Self.consentCopy.last?.kind { Divider() }
                }
            }
            .hmCard()
            Label("Your health information is never sold or used for advertising. You can export or delete it at any time.", systemImage: "checkmark.shield")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
    }

    private var remindersStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Choose what HealthMate can remind you about. You can fine-tune this later in Profile.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            VStack(spacing: 0) {
                reminderToggle("Medication reminders", detail: "At the times in your plan, with the instructions you entered.", isOn: $draft.reminders.medication)
                Divider()
                reminderToggle("Tasks and habits", detail: "Things you've added to My Plan.", isOn: $draft.reminders.task)
                Divider()
                reminderToggle("Appointments", detail: "The day before and on the day.", isOn: $draft.reminders.appointment)
                Divider()
                reminderToggle("Show health details in notifications", detail: "Off keeps notifications generic on the lock screen.", isOn: $draft.reminders.showDetails)
            }
            .hmCard()
            PermissionPrimerView(
                systemImage: "bell.badge",
                title: "Allow notifications",
                message: "So reminders can reach you even when HealthMate is closed.",
                status: notificationStatus,
                deniedHelp: "Notifications are off for HealthMate. You can turn them on in Settings › Notifications."
            ) {
                switch notificationStatus {
                case .prompt:
                    Button("Allow notifications") {
                        Task {
                            _ = await reminders.requestAuthorization()
                            notificationStatus = Self.status(await reminders.authorization())
                        }
                    }
                    .buttonStyle(.hmSecondary)
                case .denied:
                    Button("Open Settings") { SystemSettings.open() }.buttonStyle(.hmSecondary)
                default:
                    EmptyView()
                }
            }
        }
    }

    private func reminderToggle(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
        }
        .padding(.vertical, 10)
    }

    private var appleHealthStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            PermissionPrimerView(
                systemImage: "heart.fill",
                tone: .red,
                title: "Bring in readings from Apple Health",
                message: "With your permission, HealthMate reads the measurements you choose — you decide which ones.",
                benefits: ["Steps, sleep, heart rate and more, in one place", "Compared with your own usual range over time", "Read-only: HealthMate never writes to Apple Health"],
                privacyNote: "You can turn off any measurement, or disconnect, in the Health app at any time.",
                status: healthStatus,
                deniedHelp: healthMessage ?? "Apple Health access is off. Turn it on in Settings › Health › Data Access & Devices."
            ) {
                switch healthStatus {
                case .prompt:
                    Button("Connect Apple Health") { Task { await connectHealth() } }
                        .buttonStyle(.hmPrimary(fullWidth: true))
                case .denied:
                    Button("Open Settings") { SystemSettings.open() }.buttonStyle(.hmSecondary)
                default:
                    EmptyView()
                }
            }
            if session.isPreview {
                Text("Preview mode: shows sample readings. Nothing is read from Apple Health.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Here's what you chose. You can change any of it later in Profile.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            summaryRow("Goals", HealthGoal.all.filter { draft.goals.contains($0.id) }.map(\.label).joined(separator: ", ").nonEmpty ?? "None chosen")
            summaryRow("Health details you added", healthDetailsSummary)
            summaryRow("Privacy", "\(draft.grantedConsentCount) of \(AccountSetupDraft.consentKinds.count) turned on")
            summaryRow("Reminders", [draft.reminders.medication ? "medications" : nil, draft.reminders.task ? "tasks" : nil, draft.reminders.appointment ? "appointments" : nil].compactMap { $0 }.joined(separator: ", ").nonEmpty ?? "Off")
            if session.isPreview {
                Text("Preview mode: your Home screen shows a sample account so you can explore every feature.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.cardMuted))
            }
        }
    }

    private var healthDetailsSummary: String {
        func count(_ n: Int, _ one: String, _ many: String) -> String? { n == 0 ? nil : "\(n) \(n == 1 ? one : many)" }
        let parts = [count(draft.conditions.count, "condition", "conditions"), count(draft.allergies.count, "allergy", "allergies"), count(draft.medications.count, "medication", "medications")].compactMap { $0 }
        return parts.isEmpty ? "None yet" : parts.joined(separator: ", ")
    }

    private func summaryRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(HM.Colors.success)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textPrimary)
                Text(value).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
        .accessibilityElement(children: .combine)
    }

    // MARK: Actions

    private var actions: some View {
        Button {
            if step == .done {
                Task { _ = await session.completeAccountSetup(draft) }
            } else {
                advance(validating: true)
            }
        } label: {
            if session.busy {
                ProgressView().tint(HM.Colors.onPrimary)
            } else {
                Text(step == .done ? "Go to Home" : "Continue")
            }
        }
        .buttonStyle(.hmPrimary(fullWidth: true))
        .disabled(session.busy || !ready)
        .accessibilityIdentifier("setupPrimaryAction")
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(HM.Colors.backgroundGradientBottom.opacity(0.92).ignoresSafeArea())
    }

    private func advance(validating: Bool) {
        if validating, let message = draft.problem(at: step) {
            problem = message
            return
        }
        if let next = step.next { go(to: next) }
    }

    private func go(to next: AccountSetupStep) {
        problem = nil
        session.errorMessage = nil
        withAnimation(reduceMotion ? nil : HMMotion.spring) { step = next }
        headingFocused = true
    }

    private func connectHealth() async {
        do {
            try await healthReader.requestAuthorization()
            UserDefaults.standard.set(true, forKey: HealthConnection.defaultsKey)
            healthStatus = .granted
        } catch {
            healthMessage = (error as? LocalizedError)?.errorDescription
            healthStatus = .denied
        }
    }

    private static func status(_ authorization: ReminderAuthorization) -> PermissionStatus {
        switch authorization {
        case .notDetermined: .prompt
        case .denied: .denied
        case .authorized: .granted
        }
    }
}

/// Optional conditions, allergies and medications, saved as "you added".
private struct AccountSetupHealthStep: View {
    @Binding var draft: AccountSetupDraft
    @State private var condition = ""
    @State private var allergy = ""
    @State private var medicationName = ""
    @State private var medicationInstruction = ""
    @State private var medicationError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Add anything you'd like the assistant to keep in mind. It's saved as something you added — you can edit or remove it later in Profile.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            listEditor("Conditions", placeholder: "A condition you've been diagnosed with", items: $draft.conditions, text: $condition)
            listEditor("Allergies", placeholder: "Something you're allergic to", items: $draft.allergies, text: $allergy)

            VStack(alignment: .leading, spacing: 10) {
                Text("Medications").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary).accessibilityAddTraits(.isHeader)
                ForEach(draft.medications) { medication in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(medication.name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                            Text(medication.instruction).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                        Spacer()
                        Button {
                            draft.medications.removeAll { $0.id == medication.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(HM.Colors.textSecondary)
                        }
                        .accessibilityLabel("Remove \(medication.name)")
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.cardMuted))
                }
                SetupField(label: "Medication name") {
                    TextField("Name", text: $medicationName)
                }
                SetupField(label: "Instructions exactly as written") {
                    TextField("Copy them word for word from your prescription or label", text: $medicationInstruction, axis: .vertical)
                }
                if let medicationError {
                    Text(medicationError).font(.hmCaption.weight(.medium)).foregroundStyle(HM.Colors.error)
                }
                Button {
                    addMedication()
                } label: {
                    Label("Add medication", systemImage: "plus")
                }
                .buttonStyle(.hmSecondary)
            }
        }
    }

    private func addMedication() {
        if medicationName.trimmingCharacters(in: .whitespaces).isEmpty {
            medicationError = "Enter the medication name."
        } else if medicationInstruction.trimmingCharacters(in: .whitespaces).isEmpty {
            medicationError = "Copy the instructions exactly as written on your prescription or label."
        } else {
            medicationError = nil
            draft.medications.append(.init(name: medicationName, instruction: medicationInstruction))
            medicationName = ""
            medicationInstruction = ""
        }
    }

    private func listEditor(_ title: String, placeholder: String, items: Binding<[String]>, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary).accessibilityAddTraits(.isHeader)
            ForEach(Array(items.wrappedValue.enumerated()), id: \.offset) { index, item in
                HStack {
                    Text(item).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                    Spacer()
                    Button {
                        items.wrappedValue.remove(at: index)
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(HM.Colors.textSecondary)
                    }
                    .accessibilityLabel("Remove \(item)")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Capsule().fill(HM.Colors.primarySoft))
            }
            HStack(spacing: 8) {
                SetupField(label: "Add to \(title.lowercased())", hideLabel: true) {
                    TextField(placeholder, text: text)
                        .submitLabel(.done)
                        .onSubmit { add(text, to: items) }
                }
                Button {
                    add(text, to: items)
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.hmSecondary)
                .accessibilityLabel("Add to \(title.lowercased())")
            }
        }
    }

    private func add(_ text: Binding<String>, to items: Binding<[String]>) {
        let value = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        items.wrappedValue.append(value)
        text.wrappedValue = ""
    }
}

/// A labelled text input in the app's field style.
private struct SetupField<Input: View>: View {
    let label: String
    var hideLabel = false
    @ViewBuilder var input: () -> Input

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !hideLabel {
                Text(label).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textPrimary)
            }
            input()
                .font(.hmBody)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 50)
                .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
                .overlay(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).strokeBorder(HM.Colors.separator))
                .accessibilityLabel(label)
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
