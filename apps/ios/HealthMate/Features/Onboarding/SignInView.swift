import HealthMateCore
import SwiftUI

/// Sign in or create an account. An account is needed only for server
/// features (AI assistant, reports, photo analysis, sync); the rest of the app
/// works without one.
struct SignInView: View {
    let session: SessionStore
    var startInSignUp = false
    var onSignedIn: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .signIn
    @State private var firstName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var errors = SignInValidator.Errors()
    @State private var nameError: String?
    @State private var shakes = 0
    @State private var showingForgotPassword = false
    @FocusState private var focused: Field?

    private enum Mode: String, CaseIterable, Identifiable { case signIn, signUp; var id: String { rawValue } }
    private enum Field { case name, email, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if session.pendingVerificationEmail != nil {
                        VerifyEmailView(session: session, onUseDifferentEmail: {
                            session.pendingVerificationEmail = nil
                            session.errorMessage = nil
                            mode = .signUp
                        }, onSignedIn: finishSignIn)
                    } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(mode == .signIn ? "Welcome back" : "Create your account")
                            .font(.hmPageHeading)
                            .foregroundStyle(HM.Colors.textPrimary)
                        Text(mode == .signIn ? "Sign in to use your AI Health Assistant." : "Your account keeps conversations, reports and memories private to you.")
                            .font(.hmBody)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                    SegmentedTabs(items: [SegmentItem(value: Mode.signIn, title: "Sign in"), SegmentItem(value: Mode.signUp, title: "Create account")], selection: $mode)

                    if SocialSignIn.isAvailable(serverIsPreview: session.isPreview) {
                        SocialSignInButtons(session: session, onSignedIn: finishSignIn)
                    }

                    if mode == .signUp {
                        field("First name", error: nameError, field: .name) {
                            TextField("Alex", text: $firstName)
                                .textContentType(.givenName)
                                .submitLabel(.next)
                                .onSubmit { focused = .email }
                        }
                    }
                    field("Email", error: errors.email, field: .email) {
                        TextField("you@example.com", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .onSubmit { focused = .password }
                    }
                    field("Password", error: errors.password, field: .password) {
                        SecureField("At least 8 characters", text: $password)
                            .textContentType(mode == .signIn ? .password : .newPassword)
                            .submitLabel(.go)
                            .onSubmit { Task { await submit() } }
                    }

                    if mode == .signIn {
                        Button("Forgot password?") { showingForgotPassword = true }
                            .font(.hmCaption.weight(.semibold))
                            .foregroundStyle(HM.Colors.primary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    if let notice = session.notice, session.errorMessage == nil {
                        Label(notice, systemImage: "envelope.badge")
                            .font(.hmCaption.weight(.medium))
                            .foregroundStyle(HM.Colors.textPrimary)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.primarySoft))
                    }

                    if let message = session.errorMessage {
                        Label(message, systemImage: "exclamationmark.circle.fill")
                            .font(.hmCaption.weight(.medium))
                            .foregroundStyle(HM.Colors.error)
                            .accessibilityAddTraits(.updatesFrequently)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        if session.busy {
                            ProgressView().tint(HM.Colors.onPrimary)
                        } else {
                            Text(mode == .signIn ? "Sign In" : "Create Account")
                        }
                    }
                    .buttonStyle(.hmPrimary(fullWidth: true))
                    .disabled(session.busy)
                    .keyframeAnimator(initialValue: 0.0, trigger: shakes) { content, x in
                        content.offset(x: x)
                    } keyframes: { _ in
                        KeyframeTrack {
                            LinearKeyframe(-8, duration: 0.06)
                            LinearKeyframe(8, duration: 0.08)
                            LinearKeyframe(-5, duration: 0.07)
                            LinearKeyframe(0, duration: 0.06)
                        }
                    }

                    DisclaimerView(text: "By creating an account you agree to our Terms and Privacy Policy. HealthMate is not a substitute for a doctor.")
                    }
                }
                .padding(24)
                .hmAnimation(HMMotion.spring, value: mode)
            }
            .background(HMGradient.appBackground.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sensoryFeedback(.error, trigger: shakes)
            .sheet(isPresented: $showingForgotPassword) {
                ForgotPasswordView(session: session, email: email)
            }
            .onAppear {
                if startInSignUp { mode = .signUp }
                session.errorMessage = nil
                session.notice = nil
            }
            .onChange(of: mode) { _, _ in
                session.errorMessage = nil
                errors = SignInValidator.Errors()
                nameError = nil
            }
        }
    }

    private func field<Input: View>(_ label: String, error: String?, field: Field, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textPrimary)
            input()
                .font(.hmBody)
                .focused($focused, equals: field)
                .padding(.horizontal, 14)
                .frame(minHeight: 50)
                .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
                .overlay(
                    RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                        .strokeBorder(error != nil ? HM.Colors.error : (focused == field ? HM.Colors.primary : HM.Colors.separator), lineWidth: focused == field || error != nil ? 2 : 1)
                )
                .accessibilityLabel(label)
                .accessibilityHint(error ?? "")
            if let error {
                Text(error).font(.hmCaption.weight(.medium)).foregroundStyle(HM.Colors.error)
            }
        }
    }

    private func submit() async {
        errors = SignInValidator.validate(email: email, password: password)
        nameError = mode == .signUp && firstName.trimmingCharacters(in: .whitespaces).isEmpty ? "Enter your first name." : nil
        guard errors.isEmpty, nameError == nil else {
            shakes += 1
            focused = nameError != nil ? .name : errors.email != nil ? .email : .password
            return
        }
        let ok = mode == .signIn
            ? await session.signIn(email: email, password: password)
            : await session.signUp(email: email, password: password, firstName: firstName.trimmingCharacters(in: .whitespaces), lastName: "")
        if ok {
            finishSignIn()
        } else if session.pendingVerificationEmail != nil {
            // Account created (or not confirmed yet): the sheet now shows "Check your email".
            mode = .signIn
            password = ""
        } else {
            shakes += 1
        }
    }

    private func finishSignIn() {
        onSignedIn()
        dismiss()
    }
}

/// Sends a reset link. The new password is chosen on the web page the link opens.
private struct ForgotPasswordView: View {
    let session: SessionStore
    @State var email: String
    @State private var sent = false
    @State private var emailError: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Forgot your password?").font(.hmPageHeading).foregroundStyle(HM.Colors.textPrimary)
                if sent, let notice = session.notice {
                    Label(notice, systemImage: "envelope.badge")
                        .font(.hmBody)
                        .foregroundStyle(HM.Colors.textPrimary)
                    Button("Done") { dismiss() }.buttonStyle(.hmPrimary(fullWidth: true))
                } else {
                    Text("Enter your email and we'll send you a link to choose a new one.")
                        .font(.hmBody)
                        .foregroundStyle(HM.Colors.textSecondary)
                    TextField("you@example.com", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.hmBody)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 50)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
                        .accessibilityLabel("Email")
                    if let error = emailError ?? session.errorMessage {
                        Label(error, systemImage: "exclamationmark.circle.fill")
                            .font(.hmCaption.weight(.medium))
                            .foregroundStyle(HM.Colors.error)
                    }
                    Button {
                        Task {
                            emailError = SignInValidator.validate(email: email, password: "placeholder").email
                            guard emailError == nil else { return }
                            sent = await session.requestPasswordReset(email: email.trimmingCharacters(in: .whitespaces))
                        }
                    } label: {
                        if session.busy { ProgressView().tint(HM.Colors.onPrimary) } else { Text("Send Reset Link") }
                    }
                    .buttonStyle(.hmPrimary(fullWidth: true))
                    .disabled(session.busy)
                }
                Spacer()
            }
            .padding(24)
            .background(HMGradient.appBackground.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
