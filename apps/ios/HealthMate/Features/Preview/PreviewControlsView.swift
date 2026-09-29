import HealthMateCore
import SwiftUI

/// Preview mode (Phase 1) controls: show any screen as loading, empty, error,
/// offline or with permissions off; open emails HealthMate "sent"; reset the
/// sample account. Only reachable in Preview mode.
struct PreviewControlsView: View {
    let session: SessionStore

    @State private var state = PreviewSettings.state
    @State private var emails: [PreviewEmail] = []
    @State private var resetToken: ResetToken?
    @State private var confirmReset = false
    @State private var message: String?

    private struct ResetToken: Identifiable { let id: String }

    var body: some View {
        List {
            Section {
                Label("Everything runs on this iPhone with a sample account. AI answers and report results are fixed samples — not real AI, and not medical advice.", systemImage: "flask")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }

            Section {
                ForEach(PreviewState.allCases) { option in
                    Button {
                        state = option
                        PreviewSettings.state = option
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                                Text(option.detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                            }
                            Spacer()
                            if state == option {
                                Image(systemName: "checkmark").foregroundStyle(HM.Colors.primary)
                            }
                        }
                    }
                    .accessibilityAddTraits(state == option ? .isSelected : [])
                }
            } header: {
                Text("Show screens as")
            } footer: {
                Text("Applies to the next load — pull to refresh or switch tabs. Tip: the password “wrong-password” shows the sign-in error.")
            }

            Section {
                if emails.isEmpty {
                    Text("No emails yet. Create an account or use “Forgot password?” to receive one.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                ForEach(emails) { email in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(email.subject).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                        Text("To \(email.to)").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        Text(email.body).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        Button(email.actionLabel) { Task { await open(email) } }
                            .buttonStyle(.hmPrimary)
                            .padding(.top, 4)
                    }
                    .padding(.vertical, 4)
                }
            } header: {
                Text("Preview inbox")
            } footer: {
                Text("In Preview mode no email is really sent; messages appear here instead.")
            }

            Section {
                Button("Reset sample account", role: .destructive) { confirmReset = true }
            } footer: {
                Text("Throws away your changes and starts again from the sample data.")
            }
        }
        .navigationTitle("Preview mode")
        .onAppear { emails = PreviewURLProtocol.backend.allEmails }
        .refreshable { emails = PreviewURLProtocol.backend.allEmails }
        .confirmationDialog("Reset the sample account?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset", role: .destructive) {
                PreviewURLProtocol.backend.reset()
                message = "The sample account was reset."
            }
        }
        .sheet(item: $resetToken) { token in
            PreviewNewPasswordView(session: session, token: token.id) { message = "Password changed. Sign in with your new password." }
        }
        .alert("Preview mode", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private func open(_ email: PreviewEmail) async {
        let token = String(email.action.split(separator: "=").last ?? "")
        if email.action.hasPrefix("verify-email") {
            message = await session.verifyEmail(token: token) ? "Email confirmed — you're signed in." : (session.errorMessage ?? "This link can't be used.")
        } else if email.action.hasPrefix("reset-password") {
            resetToken = ResetToken(id: token)
        }
    }
}

/// Choosing a new password from the (Preview) reset email.
private struct PreviewNewPasswordView: View {
    let session: SessionStore
    let token: String
    var onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("New password", text: $password).textContentType(.newPassword)
                    SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
                } footer: {
                    Text("At least 8 characters. You'll be signed out on your other devices.")
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error)
                }
            }
            .navigationTitle("New password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving)
                }
            }
        }
    }

    private func save() async {
        guard password.count >= 8 else { error = "Use at least 8 characters."; return }
        guard password == confirm else { error = "The passwords don't match."; return }
        saving = true
        defer { saving = false }
        do {
            try await session.api.completePasswordReset(token: token, password: password)
            onDone()
            dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "This reset link is invalid or has expired."
        }
    }
}
