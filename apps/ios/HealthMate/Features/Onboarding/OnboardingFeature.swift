import HealthMateCore

/// Shared copy with the web welcome screen (apps/web/src/lib/onboarding.ts).
struct OnboardingFeature: Identifiable {
    let title: String
    let description: String
    let systemImage: String
    let tone: Tone
    var id: String { title }

    static let all: [OnboardingFeature] = [
        OnboardingFeature(title: "AI Health Assistant", description: "Plain-language answers to health questions, any time", systemImage: "person.fill", tone: .blue),
        OnboardingFeature(title: "Track Your Health", description: "Sync with Apple Health & wearables", systemImage: "heart.fill", tone: .teal),
        OnboardingFeature(title: "Understand Your Reports", description: "Upload reports for clear, simple explanations", systemImage: "doc.text.fill", tone: .green),
        OnboardingFeature(title: "Stay on Track", description: "Reminders for your care plan, water, habits & more", systemImage: "figure.walk", tone: .green),
    ]
}
