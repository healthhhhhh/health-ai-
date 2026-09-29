import HealthMateCore
import SwiftUI
import UserNotifications

/// Settings: notifications, display, privacy, your data, account and about. Mirrors web /settings.
struct SettingsView: View {
    let session: SessionStore
    var onRestartOnboarding: () -> Void = {}

    @AppStorage("hmAppearance") private var appearance = Appearance.system.rawValue
    @AppStorage("hmWeightUnit") private var weightUnit = WeightUnit.kilograms.rawValue
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var exportError: String?
    @State private var showDelete = false
    @State private var confirmSignOut = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "1.0") (\(info?["CFBundleVersion"] as? String ?? "1"))"
    }

    var body: some View {
        List {
            Section {
                NavigationLink { NotificationSettingsView(session: session) } label: {
                    Label("Notifications", systemImage: "bell.badge")
                }
            }

            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(Appearance.allCases) { Text($0.label).tag($0.rawValue) }
                }
                Picker("Weight", selection: Binding(
                    get: { weightUnit },
                    set: { raw in
                        // Update the formatter first so screens that re-render show the new unit.
                        TrackedMetric.weightUnit = WeightUnit(rawValue: raw) ?? .kilograms
                        weightUnit = raw
                    }
                )) {
                    ForEach(WeightUnit.allCases) { Text($0.label).tag($0.rawValue) }
                }
            } header: {
                Text("Display")
            } footer: {
                Text("Weight changes how readings are shown. They're stored the same way either way.")
            }

            if session.isSignedIn {
                Section {
                    consentToggle("ai_processing", title: "AI Health Assistant", detail: "Send your messages and saved health details to our AI provider to answer you.")
                    consentToggle("document_processing", title: "Report & photo analysis", detail: "Send files you upload to our AI provider for a plain-language summary.")
                    consentToggle("health_data_sync", title: "Health data sync", detail: "Store Apple Health measurements you choose in your account.")
                } header: {
                    Text("Privacy")
                } footer: {
                    Text("Turning a switch off stops new processing right away. Your data is never sold or used for advertising.")
                }

                Section {
                    Button {
                        Task { await export() }
                    } label: {
                        HStack {
                            Label("Download my data", systemImage: "square.and.arrow.down")
                            Spacer()
                            if exporting { ProgressView() }
                        }
                    }
                    .disabled(exporting)
                    if let exportError { Text(exportError).font(.hmCaption).foregroundStyle(HM.Colors.error) }
                } header: {
                    Text("Your data")
                } footer: {
                    Text("Everything HealthMate holds about you — profile, readings, plan, timeline, conversations, reports and care details — as a JSON file.")
                }

                Section("Account") {
                    NavigationLink { AccountView(session: session) } label: { Label("Account & password", systemImage: "person.badge.key") }
                    Button(role: .destructive) { confirmSignOut = true } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }

            Section {
                if session.isPreview {
                    NavigationLink { PreviewControlsView(session: session) } label: { Label("Preview mode", systemImage: "flask") }
                }
                Link(destination: AppLinks.privacy) { Label("Privacy Policy", systemImage: "hand.raised") }
                Link(destination: AppLinks.terms) { Label("Terms of Use", systemImage: "doc.text") }
                NavigationLink { DesignSystemGallery() } label: { Label("Design system", systemImage: "paintpalette") }
                Button(action: onRestartOnboarding) { Label("Show welcome screens", systemImage: "arrow.uturn.backward") }
                LabeledContent("Version", value: version)
            } header: {
                Text("About")
            } footer: {
                Text("HealthMate is an AI health companion, not a doctor. It helps you understand and organise your health information; it doesn't diagnose or treat.\(session.isPreview ? " You're using Preview mode: everything here is sample data." : "")")
            }

            if session.isSignedIn {
                Section {
                    Button(role: .destructive) { showDelete = true } label: {
                        Label("Delete account and all data", systemImage: "trash")
                    }
                }
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showDelete) { DeleteAccountView(session: session) }
        .sheet(item: $exportURL) { url in ShareSheet(items: [url]) }
        .confirmationDialog("Sign out of HealthMate?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
        } message: {
            Text("Your plan stays on this device. Conversations and your health profile stay in your account.")
        }
    }

    private func consentToggle(_ kind: String, title: String, detail: String) -> some View {
        Toggle(isOn: Binding(
            get: { session.hasConsent(kind) },
            set: { granted in Task { await session.setConsent(kind, granted: granted) } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
        }
    }

    private func export() async {
        exporting = true
        exportError = nil
        defer { exporting = false }
        do {
            let data = try await session.api.exportData()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("HealthMate-export.json")
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            exportURL = url
        } catch {
            session.handle(error)
            exportError = (error as? LocalizedError)?.errorDescription ?? "Couldn't prepare your download."
        }
    }
}

/// Which reminders and alerts to send, lock-screen privacy and quiet hours, plus the system permission.
struct NotificationSettingsView: View {
    let session: SessionStore

    @AppStorage("showReminderDetails") private var showReminderDetails = false
    @Environment(\.openURL) private var openURL
    @State private var prefs: NotificationPreferences?
    @State private var state: ScreenState? = .loading
    @State private var unavailable = false
    @State private var system: UNAuthorizationStatus = .notDetermined
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                switch system {
                case .denied:
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Notifications are off for HealthMate", systemImage: "bell.slash").font(.hmBodyEmphasis)
                        Text("Reminders can't be delivered until you allow them.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                    }
                case .notDetermined:
                    Text("HealthMate will ask to send notifications the first time you turn on a reminder.").font(.hmCaption)
                default:
                    Label("Notifications are allowed", systemImage: "checkmark.circle.fill").foregroundStyle(HM.Colors.success)
                }
            } header: {
                Text("On this iPhone")
            }

            if session.isSignedIn, let state {
                Section {
                    StateView(state: state, title: state == .loading || state == .offline ? nil : "Notification settings couldn't load") {
                        if state != .loading { Button("Try again") { Task { await load() } }.buttonStyle(.hmSecondary) }
                    }
                    .frame(maxWidth: .infinity)
                }
            } else if session.isSignedIn, unavailable {
                Section {
                    Text("Notification choices aren't available on this server yet. The lock-screen setting below still applies on this iPhone.").font(.hmCaption)
                }
            } else if session.isSignedIn, let binding = Binding($prefs) {
                Section("What to send") {
                    Toggle("Medication reminders", isOn: binding.medication)
                    Toggle("Tasks and habits", isOn: binding.task)
                    Toggle("Appointments", isOn: binding.appointment)
                    Toggle("Reports and photos", isOn: binding.report)
                    Toggle("Weekly insights", isOn: binding.insight)
                    Text("Account and security messages are always sent.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                }
                Section {
                    Toggle("Hold non-urgent notifications", isOn: binding.quietHours.enabled)
                    if prefs?.quietHours.enabled == true {
                        TextField("From (HH:mm)", text: binding.quietHours.start).keyboardType(.numbersAndPunctuation)
                        TextField("Until (HH:mm)", text: binding.quietHours.end).keyboardType(.numbersAndPunctuation)
                    }
                } header: {
                    Text("Quiet hours")
                } footer: {
                    Text("Medication reminders you've scheduled in these hours are still sent.")
                }
            }

            Section {
                Toggle("Show names and details", isOn: Binding(
                    get: { prefs?.showDetails ?? showReminderDetails },
                    set: { value in
                        showReminderDetails = value
                        prefs?.showDetails = value
                    }
                ))
            } header: {
                Text("Privacy on the lock screen")
            } footer: {
                Text("Off: reminders only say something is due, so nothing about your health appears on the lock screen.")
            }

            if session.isSignedIn, prefs != nil {
                Section {
                    Button { Task { await save() } } label: {
                        HStack {
                            Text("Save notification settings")
                            Spacer()
                            if saving { ProgressView() }
                        }
                    }
                    .disabled(saving)
                    if saved { Text("Saved.").font(.hmCaption).foregroundStyle(HM.Colors.success) }
                    if let error { Text(error).font(.hmCaption).foregroundStyle(HM.Colors.error) }
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        system = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard session.isSignedIn else { state = nil; return }
        state = .loading
        do {
            prefs = try await session.api.notificationPreferences()
            state = nil
        } catch APIError.server(404, _, _), APIError.server(405, _, _) {
            unavailable = true
            state = nil
        } catch {
            session.handle(error)
            state = ScreenState.from(error)
        }
    }

    private func save() async {
        guard var prefs else { return }
        let time = #"^\d{2}:\d{2}$"#
        if prefs.quietHours.start.range(of: time, options: .regularExpression) == nil || prefs.quietHours.end.range(of: time, options: .regularExpression) == nil {
            error = "Enter quiet hours as HH:mm, for example 22:00."
            return
        }
        prefs.account = true
        saving = true
        saved = false
        error = nil
        defer { saving = false }
        do {
            try await session.api.updateNotificationPreferences(prefs)
            showReminderDetails = prefs.showDetails
            saved = true
        } catch {
            session.handle(error)
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save."
        }
    }
}

/// Sign-in details and changing the password. Mirrors web /settings/account.
struct AccountView: View {
    let session: SessionStore

    @State private var account: AccountSummary?
    @State private var state: ScreenState? = .loading
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var saving = false
    @State private var message: (text: String, ok: Bool)?

    var body: some View {
        Form {
            if let state {
                Section {
                    StateView(state: state, title: state == .loading || state == .offline ? nil : "Your account details couldn't load") {
                        if state != .loading { Button("Try again") { Task { await load() } }.buttonStyle(.hmSecondary) }
                    }
                    .frame(maxWidth: .infinity)
                }
            } else if let account {
                Section("Sign-in") {
                    LabeledContent("Email") {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(account.email)
                            Text(account.emailVerified ? "Verified" : "Not verified").font(.hmMicro).foregroundStyle(account.emailVerified ? HM.Colors.success : HM.Colors.warning)
                        }
                    }
                    LabeledContent("Signs in with", value: account.signInMethods.map(methodLabel).joined(separator: ", "))
                    LabeledContent("Member since", value: account.createdAt.formatted(date: .abbreviated, time: .omitted))
                }
                if account.signInMethods.contains("password") {
                    Section {
                        SecureField("Current password", text: $current).textContentType(.password)
                        SecureField("New password (at least 8 characters)", text: $new).textContentType(.newPassword)
                        SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
                        Button { Task { await changePassword() } } label: {
                            HStack {
                                Text("Change password")
                                Spacer()
                                if saving { ProgressView() }
                            }
                        }
                        .disabled(saving || current.isEmpty || new.isEmpty)
                        if let message { Text(message.text).font(.hmCaption).foregroundStyle(message.ok ? HM.Colors.success : HM.Colors.error) }
                    } header: {
                        Text("Password")
                    } footer: {
                        Text("You'll stay signed in on this iPhone.")
                    }
                } else {
                    Section {
                        Text("You sign in with \(account.signInMethods.map(methodLabel).joined(separator: " or ")), so there's no HealthMate password to change.").font(.hmCaption)
                    }
                }
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func methodLabel(_ method: String) -> String {
        switch method {
        case "password": "Email and password"
        case "apple": "Apple"
        case "google": "Google"
        default: method
        }
    }

    private func load() async {
        state = .loading
        do {
            account = try await session.api.accountSummary()
            state = nil
        } catch {
            session.handle(error)
            state = ScreenState.from(error)
        }
    }

    private func changePassword() async {
        guard new.count >= 8 else { message = ("Use at least 8 characters for the new password.", false); return }
        guard new == confirm else { message = ("The new passwords don't match.", false); return }
        saving = true
        defer { saving = false }
        do {
            try await session.api.changePassword(current: current, new: new)
            current = ""
            new = ""
            confirm = ""
            message = ("Password changed.", true)
        } catch APIError.server(404, _, _), APIError.server(405, _, _) {
            message = ("Changing the password isn't available on this server yet.", false)
        } catch APIError.server(let status, _, _) where status == 400 || status == 401 {
            message = ("That current password isn't right.", false)
        } catch {
            message = ((error as? LocalizedError)?.errorDescription ?? "Couldn't change the password.", false)
        }
    }
}
