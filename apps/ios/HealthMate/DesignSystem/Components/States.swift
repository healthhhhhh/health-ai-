import HealthMateCore
import SwiftUI

struct EmptyStateView<Action: View>: View {
    let systemImage: String
    var tone: Tone = .blue
    let title: String
    let message: String
    @ViewBuilder var action: () -> Action

    var body: some View {
        VStack(spacing: 12) {
            IconBadge(systemName: systemImage, tone: tone, size: .large)
            Text(title).font(.hmSectionHeading).foregroundStyle(HM.Colors.textPrimary).multilineTextAlignment(.center)
            Text(message).font(.hmBody).foregroundStyle(HM.Colors.textSecondary).multilineTextAlignment(.center)
            action().padding(.top, 4)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
    }
}

extension EmptyStateView where Action == EmptyView {
    init(systemImage: String, tone: Tone = .blue, title: String, message: String) {
        self.init(systemImage: systemImage, tone: tone, title: title, message: message) { EmptyView() }
    }
}

/// Safety copy shown wherever AI output appears.
struct DisclaimerView: View {
    var text = "HealthMate's AI Health Assistant offers general information, not a diagnosis. It is not a substitute for a doctor. In an emergency, contact your local emergency services."

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.shield")
                .foregroundStyle(HM.Colors.primary)
                .accessibilityHidden(true)
            Text(text).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Marks screens that are rendering sample data.
struct SampleDataBanner: View {
    var body: some View {
        Label("Demo mode — sample data, not real measurements", systemImage: "flask")
            .font(.hmMicro)
            .foregroundStyle(HM.Colors.warning)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(HM.Colors.warningSoft))
    }
}

/// Upload call-to-action card (reports and images, Phase 6/8).
struct UploadCard: View {
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: "arrow.up.doc")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(HM.Colors.primary)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(HM.Colors.card).hmShadow())
                Text(title).font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                Text(subtitle).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(HM.Colors.primarySoft.opacity(0.6)))
            .overlay(
                RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous)
                    .strokeBorder(HM.Colors.primaryTint, style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
            )
        }
        .buttonStyle(PressableButtonStyle())
    }
}

/// An uploaded report with its analysis status.
struct ReportCard: View {
    let fileName: String
    let meta: String
    var status: StatusBadge?

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: "doc.text", tone: .blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(fileName).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary).lineLimit(1)
                Text(meta).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer()
            status
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(HM.Colors.textMuted)
        }
        .hmCard(padding: 12, radius: HM.Radius.md)
        .accessibilityElement(children: .combine)
    }
}

/// Frame for a chart: title → headline value → context → chart (charts arrive in Phase 5).
struct ChartCard<Chart: View>: View {
    let title: String
    let systemImage: String
    let tone: Tone
    let value: String
    var unit: String?
    var context: String?
    @ViewBuilder var chart: () -> Chart

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.hmCaption.weight(.semibold))
                .foregroundStyle(tone.color)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.hmMetric).foregroundStyle(HM.Colors.textPrimary)
                if let unit { Text(unit).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            }
            if let context { Text(context).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            chart().padding(.top, 6)
        }
        .hmCard()
    }
}
