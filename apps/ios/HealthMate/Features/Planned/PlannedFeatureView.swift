import HealthMateCore
import SwiftUI

/// A real tab whose feature is scheduled for a later phase — an honest empty
/// state instead of fake UI.
struct PlannedFeatureView: View {
    let title: String
    let systemImage: String
    var tone: Tone = .blue
    let phase: String
    let summary: String

    var body: some View {
        NavigationStack {
            ScrollView {
                EmptyStateView(systemImage: systemImage, tone: tone, title: "Coming in \(phase)", message: summary)
                    .hmCard()
                    .padding(HM.Spacing.lg)
                    .appearAnimation()
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle(title)
        }
    }
}

/// Chat tab until Phase 4. Keeps the user's question so nothing they typed is lost.
struct ChatPlaceholderView: View {
    let pendingQuestion: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: HM.Spacing.md) {
                    MascotView(size: 140, withBackdrop: true)
                        .padding(.top, HM.Spacing.xl)
                    if let pendingQuestion {
                        ChatBubble(author: .user, text: pendingQuestion)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                    ChatBubble(author: .assistant, text: "Conversations with me arrive in Phase 4. I'll ask follow-up questions, explain things in plain language, and tell you when it's time to see a professional.")
                        .appearAnimation(delay: 0.2)
                    DisclaimerView().padding(.top, HM.Spacing.xs)
                }
                .padding(HM.Spacing.lg)
                .animation(HMMotion.spring, value: pendingQuestion)
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("AI Health Assistant")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ProfileView: View {
    var onSignOut: () -> Void
    @AppStorage("showReminderDetails") private var showReminderDetails = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Health profile, conditions and allergies arrive with authentication in Phase 2.", systemImage: "person.text.rectangle")
                        .font(.hmBody)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                Section {
                    Toggle("Show names in reminders", isOn: $showReminderDetails)
                } header: {
                    Text("Privacy")
                } footer: {
                    Text("Off: reminders only say something is due, so nothing about your health appears on the lock screen. Takes effect the next time your plan changes.")
                }
                Section("App") {
                    NavigationLink {
                        DesignSystemGallery()
                    } label: {
                        Label("Design system", systemImage: "paintpalette")
                    }
                    Button(role: .destructive, action: onSignOut) {
                        Label("Restart onboarding", systemImage: "arrow.uturn.backward")
                    }
                }
                Section {
                    DisclaimerView()
                }
            }
            .navigationTitle("Profile")
        }
    }
}
