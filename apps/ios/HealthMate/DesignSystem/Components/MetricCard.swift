import HealthMateCore
import SwiftUI

/// Metric tile: icon → label → value → context (Data → Context → Meaning).
struct MetricCard: View {
    let presentation: MetricPresentation
    let systemImage: String
    /// Heart-rate style gentle "beat" on the icon.
    var beats = false
    /// Home keeps cards to label + value like the reference; the Health tab shows context.
    var showsContext = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 2) {
                Text(presentation.label)
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(presentation.value)
                        .font(.hmMetric)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .contentTransition(.numericText())
                    if let unit = presentation.unit {
                        Text(unit).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                if showsContext, let context = presentation.context {
                    Text(context)
                        .font(.hmMicro)
                        .foregroundStyle(HM.Colors.textSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .hmCard(padding: 14)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var icon: some View {
        if beats && !reduceMotion {
            PhaseAnimator([1.0, 1.16, 1.0, 1.1, 1.0]) { scale in
                IconBadge(systemName: systemImage, tone: presentation.tone).scaleEffect(scale)
            } animation: { phase in
                phase == 1.0 ? .easeInOut(duration: 0.5) : .easeOut(duration: 0.14)
            }
        } else {
            IconBadge(systemName: systemImage, tone: presentation.tone)
        }
    }
}

/// AI-generated observation — always labelled, always shows its basis.
struct InsightCard: View {
    let message: String
    let basedOn: String
    var isSample = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(HM.Colors.purple)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(HM.Colors.card))
                    .symbolEffect(.pulse, options: .repeating)
                Text("AI Insight").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                if isSample { StatusBadge(status: .neutral, text: "Sample") }
                Spacer()
            }
            Text(message).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
            Text("AI-generated from \(basedOn). Not a diagnosis.")
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
        }
        .padding(HM.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(HMGradient.insight))
        .accessibilityElement(children: .combine)
    }
}
