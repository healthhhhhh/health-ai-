import HealthMateCore
import SwiftUI

/// Short alias used throughout the UI: `HM.Colors.primary`, `HM.Spacing.md`…
typealias HM = DesignTokens

// MARK: - Typography
//
// Every style maps to a Dynamic Type text style so it scales with the user's
// preferred size. Point sizes in tokens.json describe the default (Large) size.
extension Font {
    static let hmDisplay = Font.system(.largeTitle, design: .default, weight: .bold)
    static let hmPageHeading = Font.system(.title2, design: .default, weight: .bold)
    static let hmSectionHeading = Font.system(.title3, design: .default, weight: .semibold)
    static let hmCardTitle = Font.system(.headline)
    static let hmBody = Font.system(.subheadline)
    static let hmBodyEmphasis = Font.system(.subheadline, design: .default, weight: .semibold)
    static let hmCaption = Font.system(.footnote)
    static let hmMicro = Font.system(.caption2, design: .default, weight: .medium)
    static let hmMetric = Font.system(.title2, design: .rounded, weight: .bold)
}

// MARK: - Tone → colour

extension Tone {
    var color: Color {
        switch self {
        case .blue: return HM.Colors.primary
        case .green: return HM.Colors.success
        case .orange: return HM.Colors.warning
        case .red: return HM.Colors.error
        case .purple: return HM.Colors.purple
        case .teal: return HM.Colors.teal
        }
    }

    var softColor: Color {
        switch self {
        case .blue: return HM.Colors.primarySoft
        case .green: return HM.Colors.successSoft
        case .orange: return HM.Colors.warningSoft
        case .red: return HM.Colors.errorSoft
        case .purple: return HM.Colors.purpleSoft
        case .teal: return HM.Colors.tealSoft
        }
    }
}

// MARK: - Shadows & gradients

extension View {
    func hmShadow(_ style: DesignTokens.ShadowStyle = HM.Shadow.card) -> some View {
        shadow(color: Color(hex: style.color, opacity: style.opacity), radius: style.radius, x: style.x, y: style.y)
    }
}

enum HMGradient {
    static let appBackground = LinearGradient(
        colors: [HM.Colors.backgroundGradientTop, HM.Colors.backgroundGradientBottom],
        startPoint: .top,
        endPoint: .bottom
    )
    static let hero = LinearGradient(
        colors: [HM.Colors.primarySoft, HM.Colors.purpleSoft, HM.Colors.primaryTint],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    static let insight = LinearGradient(
        colors: [HM.Colors.purpleSoft, HM.Colors.primarySoft],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}
