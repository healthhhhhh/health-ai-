import HealthMateCore
import SwiftUI

/// Sign-in UI with validation. Real authentication arrives in Phase 2; until
/// then a valid submission says so honestly and offers demo mode.
struct SignInView: View {
    var onContinueInDemo: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var errors = SignInValidator.Errors()
    @State private var showUnavailable = false
    @State private var shakes = 0
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Welcome back").font(.hmPageHeading).foregroundStyle(HM.Colors.textPrimary)
                        Text("Sign in to continue to HealthMate.").font(.hmBody).foregroundStyle(HM.Colors.textSecondary)
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
                            .textContentType(.password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                    }
                    Button("Sign In", action: submit)
                        .buttonStyle(.hmPrimary(fullWidth: true))
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
                    if showUnavailable {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Account sign-in isn't available in this preview yet.", systemImage: "info.circle.fill")
                                .font(.hmCaption)
                                .foregroundStyle(HM.Colors.textPrimary)
                            Button("Continue in demo mode →", action: onContinueInDemo)
                                .font(.hmBodyEmphasis)
                                .foregroundStyle(HM.Colors.primary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.primarySoft))
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(24)
            }
            .background(HMGradient.appBackground.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .sensoryFeedback(.error, trigger: shakes)
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

    private func submit() {
        errors = SignInValidator.validate(email: email, password: password)
        withAnimation(HMMotion.spring) {
            showUnavailable = errors.isEmpty
        }
        if !errors.isEmpty {
            shakes += 1
            focused = errors.email != nil ? .email : .password
        }
    }
}
