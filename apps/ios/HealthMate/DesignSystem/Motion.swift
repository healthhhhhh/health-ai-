import SwiftUI

/// Shared motion language: soft springs, short staggers, and everything
/// disabled or reduced when the user turns on Reduce Motion.
enum HMMotion {
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.78)
    static let bouncy = Animation.spring(response: 0.35, dampingFraction: 0.55)
    static let gentle = Animation.easeOut(duration: 0.5)
    static let stagger: Double = 0.06

    /// For `withAnimation`: nil (no motion) when Reduce Motion is on.
    static func respecting(_ animation: Animation) -> Animation? {
        UIAccessibility.isReduceMotionEnabled ? nil : animation
    }
}

/// `.animation(_:value:)` that turns into no animation with Reduce Motion on.
private struct ReduceMotionAnimation<Value: Equatable>: ViewModifier {
    let animation: Animation
    let value: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : animation, value: value)
    }
}

/// Fades and lifts content in the first time it appears.
private struct AppearModifier: ViewModifier {
    let delay: Double
    @State private var visible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reduceMotion ? 0 : 14)
            .onAppear {
                guard !visible else { return }
                withAnimation(reduceMotion ? .linear(duration: 0.15) : HMMotion.gentle.delay(delay)) {
                    visible = true
                }
            }
    }
}

/// Scales slightly while pressed — used by all tappable cards and buttons.
struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .hmAnimation(HMMotion.bouncy, value: configuration.isPressed)
    }
}

extension View {
    func appearAnimation(delay: Double = 0) -> some View {
        modifier(AppearModifier(delay: delay))
    }

    /// Animates changes to `value`, except with Reduce Motion on.
    func hmAnimation<Value: Equatable>(_ animation: Animation, value: Value) -> some View {
        modifier(ReduceMotionAnimation(animation: animation, value: value))
    }
}
