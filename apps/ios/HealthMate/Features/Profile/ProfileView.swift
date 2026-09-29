import HealthMateCore
import SwiftUI

/// Profile: health profile, health memory, privacy & data controls, account.
struct ProfileView: View {
    let session: SessionStore
    var onRestartOnboarding: () -> Void

    @State private var model: ProfileViewModel
    @State private var showSignIn = false
    @State private var adding: AddKind?

    enum AddKind: String, Identifiable { case condition, allergy, medication; var id: String { rawValue } }

    init(session: SessionStore, onRestartOnboarding: @escaping () -> Void) {
        self.session = session
        self.onRestartOnboarding = onRestartOnboarding
        _model = State(initialValue: ProfileViewModel(api: session.api, onSessionEnded: { [session] in session.handle($0) }))
    }

    var body: some View {
        NavigationStack {
            List {
                if session.isSignedIn && session.isDemo {
                    Section { SampleDataBanner(text: session.isPreview ? "Preview mode — sample account, not real health data" : "Demo account — example content, not real health data") }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if session.isSignedIn {
                    signedInSections
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Keep your health profile in one place")
                                .font(.hmCardTitle)
                            Text("Create an account to save conditions, allergies and medications, use the AI Health Assistant and analyse reports. Your plan works without one.")
                                .font(.hmCaption)
                                .foregroundStyle(HM.Colors.textSecondary)
                            Button("Sign in or create account") { showSignIn = true }
                                .buttonStyle(.hmPrimary(fullWidth: true))
                        }
                        .padding(.vertical, 6)
                    }
                }

                Section {
                    NavigationLink {
                        SettingsView(session: session, onRestartOnboarding: onRestartOnboarding)
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                } footer: {
                    Text("Notifications, display, privacy, your data, account and about.")
                }

                Section { DisclaimerView() }
            }
            .navigationTitle("Profile")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        SettingsView(session: session, onRestartOnboarding: onRestartOnboarding)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .refreshable { if session.isSignedIn { await model.load() } }
            .overlay {
                if session.isSignedIn, case .loading = model.state {
                    ProgressView().accessibilityLabel("Loading your profile")
                }
            }
            .sheet(isPresented: $showSignIn) { SignInView(session: session, onSignedIn: {}) }
            .sheet(item: $adding) { kind in
                AddProfileItemView(kind: kind, model: model)
            }
            .alert("Something went wrong", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.errorMessage ?? "")
            }
        }
        .task(id: session.state) {
            if session.isSignedIn { await model.load() } else { model.reset() }
        }
    }

    @ViewBuilder
    private var signedInSections: some View {
        if case .failed(let message) = model.state {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label(message, systemImage: "wifi.exclamationmark").font(.hmCaption)
                    Button("Try again") { Task { await model.load() } }
                }
            }
        }
        if let profile = model.profile {
            Section {
                HStack(spacing: 14) {
                    Text(initials(profile.profile))
                        .font(.hmSectionHeading)
                        .foregroundStyle(HM.Colors.onPrimary)
                        .frame(width: 54, height: 54)
                        .background(Circle().fill(HM.Colors.primaryFill))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(profile.profile.firstName) \(profile.profile.lastName)".trimmingCharacters(in: .whitespaces))
                            .font(.hmCardTitle)
                        Text(profile.profile.timeZone).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                ForEach(profile.conditions) { condition in
                    ProfileItemRow(title: condition.name, detail: condition.notes, source: condition.source.label, systemImage: "heart.text.square", tone: .purple)
                }
                .onDelete { offsets in remove("conditions", ids: offsets.map { profile.conditions[$0].id }) }
                Button { adding = .condition } label: { Label("Add condition", systemImage: "plus.circle") }
            } header: {
                Text("Conditions")
            }

            Section {
                ForEach(profile.allergies) { allergy in
                    ProfileItemRow(title: allergy.substance, detail: allergy.reaction, source: allergy.source.label, systemImage: "allergens", tone: .orange)
                }
                .onDelete { offsets in remove("allergies", ids: offsets.map { profile.allergies[$0].id }) }
                Button { adding = .allergy } label: { Label("Add allergy", systemImage: "plus.circle") }
            } header: {
                Text("Allergies")
            }

            Section {
                ForEach(profile.medications) { medication in
                    ProfileItemRow(title: medication.name, detail: medication.instruction, source: medication.source.label, systemImage: "pills", tone: .teal)
                }
                .onDelete { offsets in remove("medications", ids: offsets.map { profile.medications[$0].id }) }
                Button { adding = .medication } label: { Label("Add medication", systemImage: "plus.circle") }
            } header: {
                Text("Medications")
            } footer: {
                Text("Instructions are saved exactly as you enter them. HealthMate never changes a medication or dose — talk to your clinician or pharmacist about changes.")
            }

            Section {
                NavigationLink {
                    MemoryListView(model: model)
                } label: {
                    HStack {
                        Label("Health memory", systemImage: "brain.head.profile")
                        Spacer()
                        Text("\(model.memories.count)").foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                NavigationLink {
                    DocumentsView(session: session)
                } label: {
                    Label("Reports & photos", systemImage: "doc.text.magnifyingglass")
                }
                NavigationLink {
                    CareHubView(api: session.api)
                } label: {
                    Label("Care: appointments and care team", systemImage: "stethoscope")
                }
            } footer: {
                Text("What the AI Health Assistant remembers about you. You can edit or delete anything.")
            }
        }
    }

    private func remove(_ collection: String, ids: [String]) {
        Task { for id in ids { await model.remove(collection, id: id) } }
    }

    private func initials(_ details: ProfileDetails) -> String {
        let letters = [details.firstName.first, details.lastName.first].compactMap { $0 }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

private struct ProfileItemRow: View {
    let title: String
    let detail: String?
    let source: String
    let systemImage: String
    let tone: Tone

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: systemImage, tone: tone)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textPrimary)
                }
                Text(source).font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// UIKit share sheet (used for the data export).
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
