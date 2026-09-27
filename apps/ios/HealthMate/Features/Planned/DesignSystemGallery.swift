import HealthMateCore
import SwiftUI

/// Living catalogue of every design-system component, for visual QA against
/// the reference. Reachable from Profile → Design system.
struct DesignSystemGallery: View {
    @State private var tab = "analysis"
    @State private var mood: Mood? = .good
    @State private var taskDone = false
    @State private var ring = 0.4
    @State private var burst = 0

    private let sampleMetric = HealthMetric(kind: .heartRate, value: 72, unit: "bpm", recordedAt: Date(), source: .sample, trend: .inUsualRange)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.xl) {
                group("Colours") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 10) {
                        ForEach(Tone.allCases, id: \.self) { tone in
                            VStack(spacing: 6) {
                                Circle().fill(tone.color).frame(width: 36, height: 36)
                                Circle().fill(tone.softColor).frame(width: 36, height: 36)
                                Text(tone.rawValue).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
                            }
                        }
                    }
                }
                group("Typography") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Display").font(.hmDisplay)
                        Text("Page heading").font(.hmPageHeading)
                        Text("Section heading").font(.hmSectionHeading)
                        Text("Card title").font(.hmCardTitle)
                        Text("Body copy for explanations.").font(.hmBody)
                        Text("Caption text").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        Text("6,428").font(.hmMetric)
                    }
                    .foregroundStyle(HM.Colors.textPrimary)
                }
                group("Buttons") {
                    VStack(alignment: .leading, spacing: 10) {
                        Button("Primary") {}.buttonStyle(.hmPrimary)
                        Button("Secondary") {}.buttonStyle(.hmSecondary)
                        Button("Link") {}.buttonStyle(.hmLink)
                        IconButton(systemName: "bell", label: "Notifications", showsBadge: true) {}
                    }
                }
                group("Cards") {
                    VStack(spacing: 12) {
                        MetricCard(presentation: MetricPresenter.present(sampleMetric), systemImage: "heart.fill", beats: true)
                        InsightCard(message: "Your sleep is trending up this week.", basedOn: "sample data", isSample: true)
                        ReportCard(fileName: "blood_test_report.pdf", meta: "2.4 MB · Uploaded", status: StatusBadge(status: .success, text: "Analyzed"))
                        UploadCard(title: "Upload a report", subtitle: "PDF, JPG, PNG or HEIC") {}
                        ChartCard(title: "Steps", systemImage: "figure.walk", tone: .green, value: "6,428", context: "+12% from last week") {
                            HMProgressBar(value: 0.64, tone: .green, label: "Steps")
                        }
                    }
                }
                group("Badges & progress") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            StatusBadge(status: .success, text: "In range")
                            StatusBadge(status: .warning, text: "Slightly high")
                            StatusBadge(status: .error, text: "Low")
                        }
                        HMProgressBar(value: ring, label: "Demo progress")
                        HStack {
                            ProgressRing(value: ring, accessibilityText: "Demo ring") {
                                Text("\(Int(ring * 100))%").font(.hmCardTitle)
                            }
                            .frame(width: 90, height: 90)
                            .overlay { CelebrationBurst(trigger: burst) }
                            Button("Animate") {
                                ring = ring > 0.9 ? 0.2 : min(1, ring + 0.3)
                                if ring >= 1 { burst += 1 }
                            }
                            .buttonStyle(.hmSecondary)
                        }
                    }
                }
                group("Controls") {
                    VStack(spacing: 12) {
                        SegmentedTabs(items: [
                            SegmentItem(value: "upload", title: "Upload"),
                            SegmentItem(value: "analysis", title: "Analysis"),
                            SegmentItem(value: "history", title: "History"),
                        ], selection: $tab)
                        MoodSelector(selection: mood) { mood = $0 }
                        TaskRow(title: "Drink water", detail: "3 of 5 glasses", time: "9:00 AM", completed: taskDone) { taskDone.toggle() }
                        MedicationRow(name: "Morning medication", instruction: "As prescribed", sourceLabel: "Sample", nextDose: "8:00 AM")
                    }
                }
                group("Timeline & chat") {
                    VStack(spacing: 12) {
                        VStack(spacing: 0) {
                            TimelineItem(systemImage: "pills", tone: .orange, title: "Medication", time: "08:30")
                            TimelineItem(systemImage: "moon.fill", tone: .purple, title: "Sleep", meta: "7h 12m", time: "08:00")
                            TimelineItem(systemImage: "heart.fill", tone: .red, title: "Heart Rate", meta: "72 bpm", time: "09:15", isLast: true)
                        }
                        ChatBubble(author: .user, text: "I've had a headache since yesterday.")
                        ChatBubble(author: .assistant, text: "I'm sorry to hear that. How would you describe it?")
                    }
                }
                group("Mascot") {
                    HStack { MascotView(size: 140, withBackdrop: true); LogoMark(size: 48) }
                }
            }
            .padding(HM.Spacing.lg)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Design System")
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.hmSectionHeading).foregroundStyle(HM.Colors.textPrimary)
            content().hmCard()
        }
    }
}

#Preview {
    NavigationStack { DesignSystemGallery() }
}
