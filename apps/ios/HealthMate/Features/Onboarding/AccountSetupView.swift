import HealthMateCore
import SwiftUI

/// First-run setup after creating an account: welcome, Apple Health (optional),
/// name and date of birth (the server checks the age before anything is saved),
/// privacy choices, the Apple Health import (only when connected) and a summary.
/// Also shown to accounts whose age the server hasn't confirmed or can't serve.
/// Mirrors the web `/onboarding` wizard, which can't connect Apple Health.
struct AccountSetupView: View {
    let session: SessionStore
    let healthReader: any HealthDataReading
    /// The app-wide sync (RootView): the import keeps going after setup closes.
    let healthSync: HealthSyncCoordinator

    @State private var step: AccountSetupStep = .welcome
    @State private var draft = AccountSetupDraft()
    @State private var loaded = false
    /// The account's current details are in the draft (Continue waits for this).
    @State private var ready = false
    @State private var problem: String?
    @State private var healthStatus: PermissionStatus = .prompt
    @State private var healthMessage: String?
    /// Apple Health was connected during setup on this iPhone.
    @State private var healthConnected = false
    /// The server can't let this account use HealthMate (yet).
    @State private var restriction: AgeEligibility?
    /// The server recently restricted an account on this device, so this unconfirmed account
    /// can't answer the age question here (`AgeRetryGuard`).
    @State private var blockedOnDevice = false
    /// Accounts that sign in with Google / Apple only confirm deletion by typing DELETE.
    @State private var hasPassword = true
    @State private var deletePassword = ""
    @State private var deleteConfirmation = ""
    @AccessibilityFocusState private var headingFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            Group {
                if let restriction {
                    restrictedPanel(restriction)
                } else if blockedOnDevice {
                    restrictedPanel(nil)
                } else {
                    setup
                }
            }
            .background(HMGradient.appBackground.ignoresSafeArea())
        }
        .task {
            guard !loaded else { return }
            loaded = true
            let account = try? await session.api.accountSummary()
            if let eligibility = account?.ageEligibility, eligibility == .ageReview || eligibility == .ageNotEligible {
                restriction = eligibility
            }
            hasPassword = account?.signInMethods.contains("password") ?? true
            blockedOnDevice = session.ageQuestionBlockedOnDevice
            // The health profile is readable only once the age check has passed.
            var profile: HealthProfile?
            if (account?.ageEligibility ?? .eligible) == .eligible {
                profile = try? await session.api.healthProfile()
            }
            let consents = (try? await session.api.consents()) ?? []
            draft = AccountSetupDraft(account: account, profile: profile?.profile, consents: Dictionary(uniqueKeysWithValues: consents.map { ($0.kind, $0.granted) }))
            ready = true
            if !healthReader.isAvailable { healthStatus = .unavailable }
        }
    }

    private var setup: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if step != .done, step != .welcome { progress }
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
                    Button(step == .importHealth ? "Continue" : "Skip") { skip() }
                        .disabled(session.busy)
                }
            }
        }
    }

    private var doneTitle: String {
        let name = draft.firstName.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "You're all set" : "You're all set, \(name)"
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Step \(step.number) of \(AccountSetupStep.countedSteps)")
                Spacer()
                if step.isOptional { Text("Optional").fontWeight(.semibold) }
            }
            .font(.hmCaption)
            .foregroundStyle(HM.Colors.textSecondary)
            ProgressView(value: Double(step.number), total: Double(AccountSetupStep.countedSteps))
                .tint(HM.Colors.primary)
                .accessibilityLabel("Setup progress")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome: welcomeStep
        case .appleHealth: appleHealthStep
        case .about: aboutStep
        case .privacy: privacyStep
        case .importHealth: importStep
        case .done: summary
        }
    }

    // MARK: Steps

    private var welcomeStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your AI health companion. Setup takes about a minute.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            welcomePoint("message.fill", "Ask health questions and get plain-language answers")
            welcomePoint("doc.text.fill", "Understand medical reports and letters")
            welcomePoint("chart.line.uptrend.xyaxis", "See how your readings change over time")
            Text("HealthMate gives general information, not medical advice. In an emergency, call 911.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
    }

    private func welcomePoint(_ systemImage: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage).foregroundStyle(HM.Colors.primary).accessibilityHidden(true)
            Text(text).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
    }

    private var appleHealthStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            PermissionPrimerView(
                systemImage: "heart.fill",
                tone: .red,
                title: "Bring in your Apple Health data",
                message: "Instead of typing it in, HealthMate can read the measurements you choose: steps, heart rate, resting heart rate, active energy, weight and sleep.",
                benefits: ["Your history and recent days, in one place", "Compared with your own usual range over time", "Read-only: HealthMate never writes to Apple Health"],
                privacyNote: "Apple asks you which measurements to share — and, if you like, your date of birth to fill in the next step. Only what you allow is imported. You can change this in the Health app at any time.",
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
            Text("Not now? You can connect later from the Health tab.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
            if session.isPreview {
                Text("Preview mode: shows sample readings. Nothing is read from Apple Health.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
        }
    }

    private var aboutStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("We need your name and date of birth. Everything else is optional.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            SetupField(label: "First name") {
                TextField("First name", text: $draft.firstName).textContentType(.givenName)
            }
            SetupField(label: "Last name (optional)") {
                TextField("Last name", text: $draft.lastName).textContentType(.familyName)
            }
            dateOfBirthField
            Picker("Sex (optional)", selection: Binding(get: { draft.sex ?? "" }, set: { draft.sex = $0.isEmpty ? nil : $0 })) {
                Text("Not set").tag("")
                ForEach(AccountSetupDraft.sexOptions.indices, id: \.self) { index in
                    Text(AccountSetupDraft.sexOptions[index].label).tag(AccountSetupDraft.sexOptions[index].value)
                }
            }
            .font(.hmBody)
        }
    }

    /// No date is suggested: the person picks it (or confirms the one Apple Health shared).
    private var dateOfBirthField: some View {
        VStack(alignment: .leading, spacing: 8) {
            DatePicker(
                "Date of birth",
                selection: Binding(get: { draft.dateOfBirth ?? Date() }, set: { draft.setDateOfBirth($0) }),
                in: ...Date(),
                displayedComponents: .date
            )
            .font(.hmBody)
            if draft.dateOfBirth == nil {
                Text("Not set yet — choose your date of birth.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
            if draft.dateOfBirthSource == .appleHealth {
                Toggle("This date from Apple Health is my date of birth", isOn: $draft.dateOfBirthConfirmed)
                    .font(.hmBody)
                    .accessibilityIdentifier("confirmDateOfBirth")
            }
            Text("Used to confirm you can use HealthMate and to give age-appropriate information. It's never sent to the AI.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
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
        ConsentCopy(kind: "health_data_sync", title: "Apple Health sync", detail: "Lets HealthMate store the Apple Health measurements you allowed in your account."),
        ConsentCopy(kind: "voice", title: "Voice input", detail: "Lets you speak to the assistant. Audio is transcribed and not kept."),
    ]

    private var privacyStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Each is off until you turn it on, and you can change them any time in Settings › Privacy.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            ForEach(Self.consentCopy) { copy in
                Toggle(isOn: Binding(get: { draft.consents[copy.kind] == true }, set: { draft.consents[copy.kind] = $0 })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(copy.title).font(.hmBody.weight(.semibold)).foregroundStyle(HM.Colors.textPrimary)
                        Text(copy.detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                .padding(.vertical, 6)
            }
            Text(healthConnected
                 ? "Apple Health sync is on because you connected Apple Health. Turn it off to skip the import. Connecting Apple Health never turns on the AI Health Assistant."
                 : "Your health information is never sold or used for advertising. You can download or delete it at any time.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
    }

    private var importStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Bringing in the Apple Health data you allowed from the last \(healthSync.historyLength.label). You can continue — the import keeps going in the background.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            switch healthSync.status {
            case .idle, .syncing:
                if let progress = healthSync.progress, progress.historyDaysTotal > 0 {
                    ProgressView(value: Double(progress.historyDaysImported), total: Double(progress.historyDaysTotal)) {
                        Text("Imported \(progress.historyDaysImported) of \(progress.historyDaysTotal) days")
                            .font(.hmCaption)
                    }
                    .tint(HM.Colors.primary)
                } else {
                    ProgressView("Importing…").font(.hmCaption)
                }
            case .succeeded(let message):
                Label(message, systemImage: "checkmark.circle.fill")
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.success)
                if message == HealthSyncCoordinator.nothingNewMessage {
                    Text("No Apple Health data was found to import. Either there's none for this period, or HealthMate wasn't allowed to read it — you can check in Settings › Health › Data Access & Devices.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.error)
                Button("Try again") { Task { await healthSync.syncNow() } }
                    .buttonStyle(.hmSecondary)
            }
            if let last = healthSync.lastSyncedAt {
                Text("Last synced \(last.formatted(.relative(presentation: .named)))")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
            Text("Apple Health data may be incomplete, and HealthMate doesn't check it medically.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Here's what you set up. You can change any of it later in Profile and Settings.")
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
            summaryRow("Name", [draft.firstName, draft.lastName].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " "))
            summaryRow("Date of birth", "Confirmed")
            summaryRow("Privacy", "\(draft.grantedConsentCount) of \(AccountSetupDraft.consentKinds.count) turned on")
            summaryRow("Apple Health", appleHealthSummary, done: healthConnected)
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

    private var appleHealthSummary: String {
        guard healthConnected else { return "Not connected — you can connect it later from the Health tab." }
        guard draft.consents["health_data_sync"] == true else { return "Connected on this iPhone; sync is off, so nothing is imported." }
        switch healthSync.status {
        case .syncing, .idle: return "Connected — importing in the background."
        case .succeeded(let message): return "Connected — \(message)"
        case .failed: return "Connected — the import didn't finish. It will try again, or use Sync now in the Health tab."
        }
    }

    private func summaryRow(_ title: String, _ value: String, done: Bool = true) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: done ? "checkmark.circle.fill" : "iphone").foregroundStyle(done ? HM.Colors.success : HM.Colors.textSecondary)
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

    /// What a person sees when the server can't let them use HealthMate (yet), or (`nil`) when
    /// this device recently had a restricted account. Nothing is collected here.
    private func restrictedPanel(_ reason: AgeEligibility?) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(Self.restrictionTitle(reason))
                    .font(.hmPageHeading)
                    .foregroundStyle(HM.Colors.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(Self.restrictionMessage(reason))
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.textSecondary)
                Text("If a date was entered by mistake, contact us from Help on the HealthMate website.")
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.textSecondary)
                Text("If you're in danger or thinking about hurting yourself, call or text 988, or call 911.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                Button("Sign out") { Task { await session.signOut() } }
                    .buttonStyle(.hmSecondary)
                DisclosureGroup("Delete my account now") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("This permanently deletes your account and everything in it. It can't be undone.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                        if hasPassword {
                            SetupField(label: "Password") {
                                SecureField("Password", text: $deletePassword).textContentType(.password)
                            }
                            Button("Delete everything") { Task { _ = await session.deleteAccount(password: deletePassword) } }
                                .buttonStyle(.hmSecondary)
                                .disabled(deletePassword.isEmpty || session.busy)
                        } else {
                            SetupField(label: "Type DELETE to confirm") {
                                TextField("DELETE", text: $deleteConfirmation)
                                    .textInputAutocapitalization(.characters)
                                    .autocorrectionDisabled()
                            }
                            Button("Delete everything") { Task { _ = await session.deleteAccountWithoutPassword() } }
                                .buttonStyle(.hmSecondary)
                                .disabled(deleteConfirmation.trimmingCharacters(in: .whitespaces) != "DELETE" || session.busy)
                        }
                        if let message = session.errorMessage {
                            Text(message).font(.hmCaption).foregroundStyle(HM.Colors.error)
                        }
                    }
                    .padding(.top, 8)
                }
                .font(.hmBody)
            }
            .padding(24)
        }
    }

    private static func restrictionTitle(_ reason: AgeEligibility?) -> String {
        switch reason {
        case .ageReview?: return "We need to check your age"
        case nil: return "We can't set up HealthMate here right now"
        default: return "HealthMate isn't available for you"
        }
    }

    private static func restrictionMessage(_ reason: AgeEligibility?) -> String {
        switch reason {
        case .ageReview?:
            return "The date of birth you entered doesn't match what we have on record, so someone needs to check it before you can continue."
        case nil:
            return "An age check on this device recently didn't allow setup, so we can't take another date of birth here for now."
        default:
            return "HealthMate is for people 13 and older, so we can't set up this account. Nothing you add is used, and this account will be deleted soon."
        }
    }

    // MARK: Actions

    private var primaryLabel: String {
        switch step {
        case .welcome: "Get started"
        case .done: "Go to Home"
        default: "Continue"
        }
    }

    private var actions: some View {
        Button {
            primary()
        } label: {
            if session.busy {
                ProgressView().tint(HM.Colors.onPrimary)
            } else {
                Text(primaryLabel)
            }
        }
        .buttonStyle(.hmPrimary(fullWidth: true))
        .disabled(session.busy || !ready)
        .accessibilityIdentifier("setupPrimaryAction")
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(HM.Colors.backgroundGradientBottom.opacity(0.92).ignoresSafeArea())
    }

    private var importsHealth: Bool { healthConnected && draft.consents["health_data_sync"] == true }

    private func primary() {
        problem = nil
        switch step {
        case .about:
            if let message = draft.problem(at: .about) {
                problem = message
                return
            }
            // The server decides who can use HealthMate; nothing else is saved before it has.
            if session.ageQuestionBlockedOnDevice {
                blockedOnDevice = true
                return
            }
            Task {
                guard let eligibility = await session.confirmAge(draft) else { return }
                switch eligibility {
                case .eligible: go(to: .privacy)
                case .ageReview, .ageNotEligible: restriction = eligibility
                default: problem = "We couldn't confirm your date of birth. Please try again."
                }
            }
        case .privacy:
            Task {
                guard await session.saveAccountSetup(draft) else { return }
                if importsHealth {
                    go(to: .importHealth)
                    await healthSync.connected(history: healthSync.historyLength)
                } else {
                    go(to: .done)
                }
            }
        case .done:
            Task { _ = await session.finishAccountSetup() }
        default:
            if let next = step.next(importsHealth: importsHealth) { go(to: next) }
        }
    }

    private func skip() {
        if let next = step.next(importsHealth: importsHealth) { go(to: next) }
    }

    private func go(to next: AccountSetupStep) {
        problem = nil
        session.errorMessage = nil
        withAnimation(reduceMotion ? nil : HMMotion.spring) { step = next }
        headingFocused = true
    }

    /// Apple's own permission sheet. HealthKit never says which *read* types were allowed,
    /// so the import itself shows whether there was anything to bring in.
    private func connectHealth() async {
        guard healthReader.isAvailable else {
            healthStatus = .unavailable
            return
        }
        do {
            try await healthReader.requestAuthorizationForSetup()
            UserDefaults.standard.set(true, forKey: HealthConnection.defaultsKey)
            healthStatus = .granted
            healthConnected = true
            // Connecting is the request to bring the data in; it can be turned off on the next screens.
            draft.consents["health_data_sync"] = true
            draft.prefillDateOfBirth(fromAppleHealth: healthReader.dateOfBirth())
        } catch {
            healthMessage = (error as? LocalizedError)?.errorDescription
            healthStatus = .denied
        }
    }
}

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
