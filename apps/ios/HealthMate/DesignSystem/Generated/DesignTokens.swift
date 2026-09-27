// GENERATED FILE — do not edit. Source: packages/design-tokens/tokens.json (run `npm run tokens`).

import SwiftUI

enum DesignTokens {
    enum Colors {
        /// Primary blue accent — buttons, active nav, links
        static let primary = Color(light: 0x2A5CE0, dark: 0x8AA8FF)
        /// Pressed / hover state for primary
        static let primaryPressed = Color(light: 0x224CC2, dark: 0xA3BBFF)
        /// Filled button / active tab background (white text sits on it)
        static let primaryFill = Color(light: 0x2F64EC, dark: 0x3F6FF0)
        /// Soft blue fills — active nav background, chips
        static let primarySoft = Color(light: 0xEAF0FF, dark: 0x1C2744)
        /// Stronger soft blue for gradients and borders
        static let primaryTint = Color(light: 0xDCE6FF, dark: 0x243357)
        /// Success green (text/icon)
        static let success = Color(light: 0x17783F, dark: 0x4CC47E)
        static let successSoft = Color(light: 0xE6F6EC, dark: 0x15301F)
        /// Warning orange (text/icon)
        static let warning = Color(light: 0xA35600, dark: 0xF4A340)
        static let warningSoft = Color(light: 0xFFF1DF, dark: 0x3A2812)
        /// Error / critical red (text/icon)
        static let error = Color(light: 0xC0342A, dark: 0xF2766C)
        static let errorSoft = Color(light: 0xFDE9E7, dark: 0x3B1A18)
        /// Secondary accent — sleep, AI
        static let purple = Color(light: 0x6B4DE6, dark: 0xA48CFF)
        static let purpleSoft = Color(light: 0xEFEAFE, dark: 0x2A2248)
        /// Secondary accent — tracking
        static let teal = Color(light: 0x0C766C, dark: 0x3CCBBC)
        static let tealSoft = Color(light: 0xE1F5F2, dark: 0x123330)
        /// App background
        static let background = Color(light: 0xF6F8FC, dark: 0x0D1220)
        static let backgroundGradientTop = Color(light: 0xEEF3FF, dark: 0x141C33)
        static let backgroundGradientBottom = Color(light: 0xFFFFFF, dark: 0x0D1220)
        /// Card background
        static let card = Color(light: 0xFFFFFF, dark: 0x161D2E)
        /// Inset / secondary surface
        static let cardMuted = Color(light: 0xF8FAFD, dark: 0x1B2336)
        static let separator = Color(light: 0xE9EDF5, dark: 0x262F44)
        /// Headings and primary text
        static let textPrimary = Color(light: 0x101828, dark: 0xF2F5FA)
        /// Body copy and captions
        static let textSecondary = Color(light: 0x5B6474, dark: 0xAAB3C5)
        /// Placeholders and tertiary text
        static let textMuted = Color(light: 0x646D80, dark: 0x7C8699)
        static let onPrimary = Color(light: 0xFFFFFF, dark: 0xFFFFFF)
    }

    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
        static let pill: CGFloat = 999
    }

    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 20
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    struct TypeStyle: Sendable {
        let size: CGFloat
        let weight: Int
        let lineHeight: CGFloat
        let tracking: CGFloat
    }

    enum Typography {
        static let display = TypeStyle(size: 34, weight: 700, lineHeight: 40, tracking: -0.6)
        static let pageHeading = TypeStyle(size: 26, weight: 700, lineHeight: 32, tracking: -0.4)
        static let sectionHeading = TypeStyle(size: 19, weight: 650, lineHeight: 24, tracking: -0.2)
        static let cardTitle = TypeStyle(size: 16, weight: 600, lineHeight: 22, tracking: -0.1)
        static let body = TypeStyle(size: 15, weight: 400, lineHeight: 22, tracking: 0)
        static let caption = TypeStyle(size: 13, weight: 400, lineHeight: 18, tracking: 0)
        static let metric = TypeStyle(size: 24, weight: 700, lineHeight: 28, tracking: -0.4)
    }

    struct ShadowStyle: Sendable {
        let x: CGFloat
        let y: CGFloat
        let radius: CGFloat
        let color: UInt32
        let opacity: Double
    }

    enum Shadow {
        static let card = ShadowStyle(x: 0, y: 6, radius: 12, color: 0x1E3A8A, opacity: 0.06)
        static let raised = ShadowStyle(x: 0, y: 10, radius: 15, color: 0x3B6EF6, opacity: 0.22)
    }
}
