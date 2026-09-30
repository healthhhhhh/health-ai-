import HealthMateCore
import SwiftUI

/// Continue with Apple / Google. Phase 1: signs in to the Preview sample
/// account; real Sign in with Apple and Google OAuth arrive in Phase 2C.
struct SocialSignInButtons: View {
    let session: SessionStore
    var onSignedIn: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button {
                Task { if await session.signIn(with: "apple") { onSignedIn() } }
            } label: {
                Label("Continue with Apple", systemImage: "apple.logo")
                    .font(.hmBody.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .foregroundStyle(.white)
                    .background(Capsule().fill(Color.black))
            }
            .buttonStyle(.plain)

            Button {
                Task { if await session.signIn(with: "google") { onSignedIn() } }
            } label: {
                HStack(spacing: 8) {
                    Text("G")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(HM.Colors.primary)
                        .accessibilityHidden(true)
                    Text("Continue with Google").font(.hmBody.weight(.semibold))
                }
                .frame(maxWidth: .infinity, minHeight: 50)
                .foregroundStyle(HM.Colors.textPrimary)
                .background(Capsule().fill(HM.Colors.card))
                .overlay(Capsule().strokeBorder(HM.Colors.separator))
            }
            .buttonStyle(.plain)

            HStack(spacing: 10) {
                Rectangle().fill(HM.Colors.separator).frame(height: 1)
                Text("or use email").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).fixedSize()
                Rectangle().fill(HM.Colors.separator).frame(height: 1)
            }
            .padding(.top, 6)
            .accessibilityHidden(true)
        }
        .disabled(session.busy)
    }
}

/// "Check your email" after creating an account (or signing in before confirming).
/// Resend with a cooldown, use a different address, or — in Preview mode — open the inbox.
struct VerifyEmailView: View {
    let session: SessionStore
    var onUseDifferentEmail: () -> Void
    var onSignedIn: () -> Void

    @State private var cooldown = 0
    @State private var sent = false
    @State private var previewEmail: PreviewEmail?
    @State private var showInbox = false

    private static let cooldownSeconds = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            IconBadge(systemName: "envelope.badge", tone: .blue, size: .large)
            VStack(alignment: .leading, spacing: 6) {
                Text("Check your email")
                    .font(.hmPageHeading)
                    .foregroundStyle(HM.Colors.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("We sent a confirmation link to \(session.pendingVerificationEmail ?? "your email"). Open it on this iPhone to finish creating your account.")
                    .font(.hmBody)
                    .foregroundStyle(HM.Colors.textSecondary)
            }

            if session.isPreview {
                previewInbox
            }

            if sent, session.errorMessage == nil {
                Label("Sent. It can take a minute to arrive — check your spam folder too.", systemImage: "checkmark.circle.fill")
                    .font(.hmCaption.weight(.medium))
                    .foregroundStyle(HM.Colors.success)
            }
            if let error = session.errorMessage {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.hmCaption.weight(.medium))
                    .foregroundStyle(HM.Colors.error)
            }

            Button {
                Task {
                    if await session.resendVerification() {
                        sent = true
                        cooldown = Self.cooldownSeconds
                    }
                }
            } label: {
                Text(cooldown > 0 ? "Resend email in \(cooldown)s" : "Resend email")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.hmSecondary)
            .disabled(session.busy || cooldown > 0)

            Button("Use a different email", action: onUseDifferentEmail)
                .buttonStyle(.hmLink)
                .frame(maxWidth: .infinity)
        }
        .task(id: cooldown) {
            guard cooldown > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            cooldown -= 1
        }
    }

    /// Preview mode: no email is really sent; the message appears here instead.
    @ViewBuilder
    private var previewInbox: some View {
        if showInbox, let email = previewEmail {
            VStack(alignment: .leading, spacing: 8) {
                Label("Preview inbox", systemImage: "tray").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                Text(email.subject).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text(email.body).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                Button(email.actionLabel) {
                    Task {
                        let token = String(email.action.split(separator: "=").last ?? "")
                        if await session.verifyEmail(token: token) { onSignedIn() }
                    }
                }
                .buttonStyle(.hmPrimary(fullWidth: true))
            }
            .hmCard()
        } else {
            Button {
                previewEmail = PreviewURLProtocol.backend.inbox(for: session.pendingVerificationEmail ?? "").first { $0.action.hasPrefix("verify-email") }
                showInbox = true
            } label: {
                Label("Open Preview inbox", systemImage: "tray").frame(maxWidth: .infinity)
            }
            .buttonStyle(.hmPrimary(fullWidth: true))
            if showInbox, previewEmail == nil {
                Text("No confirmation email yet. Tap Resend email.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
        }
    }
}
