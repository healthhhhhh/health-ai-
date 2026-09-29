import HealthMateCore
import SwiftUI

/// The standard row: icon badge, title, subtitle, trailing value and chevron.
/// Use inside a `List` or a card. Mirrors the web `ListRow`.
struct ListRow: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var tone: Tone = .blue
    var trailing: String?
    var showsChevron = false
    var unread = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let systemImage { IconBadge(systemName: systemImage, tone: tone, size: .small) }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if unread {
                        Circle().fill(HM.Colors.primaryFill).frame(width: 8, height: 8).accessibilityHidden(true)
                    }
                    Text(title).font(unread ? .hmBodyEmphasis : .hmBody).foregroundStyle(HM.Colors.textPrimary)
                }
                if let subtitle { Text(subtitle).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            }
            Spacer(minLength: 8)
            if let trailing { Text(trailing).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            if showsChevron {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(HM.Colors.textMuted).accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(unread ? "Unread: \(title)" : title)
    }
}

/// Where a health fact came from — next to every fact (CLAUDE.md).
struct SourceBadge: View {
    let provenance: Provenance

    init(_ provenance: Provenance) { self.provenance = provenance }

    /// From an API source string; unknown values show as "You added this".
    init(source: String) { self.provenance = Provenance(rawValue: source) ?? .userReported }

    var body: some View {
        Text(provenance.label)
            .font(.hmMicro)
            .foregroundStyle(provenance == .userReported ? HM.Colors.textSecondary : provenance.tone.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(provenance == .userReported ? HM.Colors.cardMuted : provenance.tone.softColor))
    }
}

/// Marks AI-written content and what it was based on.
struct AIGeneratedLabel: View {
    var basedOn: String?

    var body: some View {
        Label {
            Text("AI-generated\(basedOn.map { " · based on \($0)" } ?? "") · not a diagnosis")
        } icon: {
            Image(systemName: "sparkles").foregroundStyle(HM.Colors.purple)
        }
        .font(.hmMicro)
        .foregroundStyle(HM.Colors.textMuted)
    }
}

/// Marks Preview-mode sample content so it's never mistaken for real data or advice.
struct SampleContentLabel: View {
    var text = "Sample content in Preview mode — not real health data."

    var body: some View {
        Label(text, systemImage: "flask")
            .font(.hmCaption.weight(.medium))
            .foregroundStyle(HM.Colors.textPrimary)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.warningSoft))
    }
}

/// Explains a permission before the system prompt, and covers the denied and
/// unavailable states (with how to change it). Mirrors the web `PermissionPrimer`.
struct PermissionPrimerView<Actions: View>: View {
    enum Status { case prompt, granted, denied, unavailable }

    let systemImage: String
    var tone: Tone = .blue
    let title: String
    let message: String
    var benefits: [String] = []
    var privacyNote: String?
    var status: Status = .prompt
    var deniedHelp: String?
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                IconBadge(systemName: systemImage, tone: tone, size: .large)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.hmSectionHeading).foregroundStyle(HM.Colors.textPrimary)
                    Text(message).font(.hmBody).foregroundStyle(HM.Colors.textSecondary)
                }
            }
            if !benefits.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(benefits, id: \.self) { benefit in
                        Label {
                            Text(benefit).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                        } icon: {
                            Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(HM.Colors.success)
                        }
                    }
                }
            }
            if let privacyNote {
                Label(privacyNote, systemImage: "checkmark.shield")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.cardMuted))
            }
            switch status {
            case .denied:
                Text(deniedHelp ?? "Access is turned off. You can turn it on in Settings.")
                    .font(.hmCaption.weight(.medium))
                    .foregroundStyle(HM.Colors.textPrimary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.warningSoft))
            case .granted:
                Label("Connected", systemImage: "checkmark.circle.fill").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.success)
            case .unavailable:
                Text("This isn't available on this device.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            case .prompt:
                EmptyView()
            }
            actions()
        }
        .hmCard(padding: HM.Spacing.lg)
    }
}

/// Opens this app's page in the Settings app (for permissions that were denied).
enum SystemSettings {
    @MainActor static func open() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
}

extension PermissionPrimerView where Actions == EmptyView {
    init(systemImage: String, tone: Tone = .blue, title: String, message: String, benefits: [String] = [], privacyNote: String? = nil, status: Status = .prompt, deniedHelp: String? = nil) {
        self.init(systemImage: systemImage, tone: tone, title: title, message: message, benefits: benefits, privacyNote: privacyNote, status: status, deniedHelp: deniedHelp) { EmptyView() }
    }
}
