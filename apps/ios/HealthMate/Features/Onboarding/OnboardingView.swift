import SwiftUI

/// First-run welcome (reference: first iOS screen).
struct OnboardingView: View {
    let session: SessionStore
    var onFinish: () -> Void

    @State private var showSignIn = false
    @State private var signUp = false
    @State private var haloPulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                logo
                    .padding(.top, 36)
                    .appearAnimation()

                Text("HealthMate")
                    .font(.hmDisplay)
                    .foregroundStyle(HM.Colors.textPrimary)
                    .padding(.top, 24)
                    .accessibilityAddTraits(.isHeader)
                    .appearAnimation(delay: 0.08)
                Text("Your AI Health Companion")
                    .font(.title3)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .padding(.top, 2)
                    .appearAnimation(delay: 0.12)

                VStack(alignment: .leading, spacing: 22) {
                    ForEach(Array(OnboardingFeature.all.enumerated()), id: \.element.id) { index, feature in
                        HStack(spacing: 14) {
                            IconBadge(systemName: feature.systemImage, tone: feature.tone, size: .large, filled: true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(feature.title).font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                                Text(feature.description).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .appearAnimation(delay: 0.2 + Double(index) * 0.09)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 40)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(HMGradient.appBackground.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { actions }
        // Leave the welcome screens only once the sheet has fully closed, so the
        // next screen (account setup or Home) isn't swapped in under a dismissing sheet.
        .sheet(isPresented: $showSignIn, onDismiss: { if session.isSignedIn { onFinish() } }) {
            SignInView(session: session, startInSignUp: signUp, onSignedIn: {})
        }
    }

    private var logo: some View {
        ZStack {
            Circle()
                .fill(HM.Colors.primaryTint.opacity(0.5))
                .frame(width: 150, height: 150)
                .scaleEffect(haloPulse ? 1.12 : 0.96)
                .opacity(haloPulse ? 0.2 : 0.8)
            Circle()
                .fill(HM.Colors.card)
                .frame(width: 124, height: 124)
                .hmShadow(HM.Shadow.raised)
            LogoMark(size: 58)
                .scaleEffect(haloPulse ? 1.05 : 1)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { haloPulse = true }
        }
        .accessibilityHidden(true)
    }

    private var legalText: AttributedString {
        let markdown = "By continuing you agree to our [Terms](\(AppLinks.terms.absoluteString)) and [Privacy Policy](\(AppLinks.privacy.absoluteString))."
        return (try? AttributedString(markdown: markdown)) ?? AttributedString("By continuing you agree to our Terms and Privacy Policy.")
    }

    private var actions: some View {
        VStack(spacing: 6) {
            Button("Get Started") {
                signUp = true
                showSignIn = true
            }
            .buttonStyle(.hmPrimary(fullWidth: true))
            HStack(spacing: 16) {
                Button("Sign In") {
                    signUp = false
                    showSignIn = true
                }
                Button("Explore without an account", action: onFinish)
            }
            .buttonStyle(.hmLink)
            Text(legalText)
                .font(.hmMicro)
                .foregroundStyle(HM.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 28)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(HM.Colors.backgroundGradientBottom.opacity(0.92).ignoresSafeArea())
        .appearAnimation(delay: 0.55)
    }
}

#Preview {
    OnboardingView(session: SessionStore(api: AppServices.preview.api), onFinish: {})
}
