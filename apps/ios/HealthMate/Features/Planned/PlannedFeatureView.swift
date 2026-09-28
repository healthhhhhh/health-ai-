import HealthMateCore
import SwiftUI

/// A real screen whose feature is scheduled for a later phase — an honest
/// empty state instead of fake UI.
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
