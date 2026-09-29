import SwiftUI

/// Filled pill button — primary call to action.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = false
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .system(.footnote, design: .default, weight: .semibold) : .system(.body, design: .default, weight: .semibold))
            .foregroundStyle(HM.Colors.onPrimary)
            .padding(.horizontal, compact ? 14 : 24)
            .frame(minHeight: compact ? 36 : 54)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(Capsule().fill(configuration.isPressed ? HM.Colors.primaryPressed : HM.Colors.primaryFill).hmShadow(HM.Shadow.raised))
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .hmAnimation(HMMotion.bouncy, value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// White pill with a hairline — secondary action.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = false
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.hmBodyEmphasis)
            .foregroundStyle(HM.Colors.primary)
            .padding(.horizontal, compact ? 16 : 22)
            .frame(minHeight: compact ? 40 : 50)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(Capsule().fill(configuration.isPressed ? HM.Colors.primarySoft : HM.Colors.card))
            .overlay(Capsule().strokeBorder(HM.Colors.separator))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .hmAnimation(HMMotion.bouncy, value: configuration.isPressed)
    }
}

/// Text-only button in the accent colour.
struct LinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .default, weight: .semibold))
            .foregroundStyle(HM.Colors.primary)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .frame(minHeight: 44)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var hmPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static func hmPrimary(fullWidth: Bool = false, compact: Bool = false) -> PrimaryButtonStyle {
        PrimaryButtonStyle(fullWidth: fullWidth, compact: compact)
    }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var hmSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == LinkButtonStyle {
    static var hmLink: LinkButtonStyle { LinkButtonStyle() }
}

/// Circular icon-only button with a required accessibility label and optional badge dot.
struct IconButton: View {
    let systemName: String
    let label: String
    var showsBadge = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 19, weight: .regular))
                .foregroundStyle(HM.Colors.textPrimary)
                .frame(width: 44, height: 44)
                .overlay(alignment: .topTrailing) {
                    if showsBadge {
                        Circle()
                            .fill(HM.Colors.error)
                            .frame(width: 9, height: 9)
                            .overlay(Circle().stroke(HM.Colors.background, lineWidth: 2))
                            .offset(x: -9, y: 9)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.9))
        .accessibilityLabel(label)
    }
}
