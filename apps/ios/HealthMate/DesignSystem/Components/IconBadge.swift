import HealthMateCore
import SwiftUI

/// Pastel circle holding a line icon — the core icon treatment of the reference.
struct IconBadge: View {
    enum Size {
        case small, medium, large
        var diameter: CGFloat { self == .small ? 32 : self == .medium ? 44 : 54 }
        var iconSize: CGFloat { self == .small ? 15 : self == .medium ? 19 : 22 }
    }

    let systemName: String
    var tone: Tone = .blue
    var size: Size = .medium
    /// Solid colour circle with a white glyph (onboarding) instead of the pastel default.
    var filled = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size.iconSize, weight: filled ? .semibold : .medium))
            .foregroundStyle(filled ? Color.white : tone.color)
            .frame(width: size.diameter, height: size.diameter)
            .background(Circle().fill(filled ? AnyShapeStyle(tone.color.gradient) : AnyShapeStyle(tone.softColor)))
            .accessibilityHidden(true)
    }
}

/// Initials avatar; swap for AsyncImage once profile photos exist.
struct AvatarView: View {
    let name: String
    var size: CGFloat = 40

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
            .foregroundStyle(HM.Colors.primary)
            .frame(width: size, height: size)
            .background(
                Circle().fill(LinearGradient(colors: [HM.Colors.primaryTint, HM.Colors.purpleSoft], startPoint: .topLeading, endPoint: .bottomTrailing))
            )
            .overlay(Circle().stroke(HM.Colors.card, lineWidth: 2))
            .accessibilityLabel(name)
    }
}

/// Status is never colour alone: every badge has an icon and a label.
struct StatusBadge: View {
    enum Status { case success, warning, error, info, neutral }

    let status: Status
    let text: String

    private var style: (fg: Color, bg: Color, icon: String?) {
        switch status {
        case .success: return (HM.Colors.success, HM.Colors.successSoft, "checkmark.circle.fill")
        case .warning: return (HM.Colors.warning, HM.Colors.warningSoft, "exclamationmark.triangle.fill")
        case .error: return (HM.Colors.error, HM.Colors.errorSoft, "exclamationmark.circle.fill")
        case .info: return (HM.Colors.primary, HM.Colors.primarySoft, "info.circle.fill")
        case .neutral: return (HM.Colors.textSecondary, HM.Colors.cardMuted, nil)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if let icon = style.icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
            Text(text).font(.hmMicro)
        }
        .foregroundStyle(style.fg)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(style.bg))
        .accessibilityElement(children: .combine)
    }
}
