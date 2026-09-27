import HealthMateCore
import SwiftUI

struct HMProgressBar: View {
    let value: Double
    var tone: Tone = .green
    let label: String

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(HM.Colors.separator)
                Capsule()
                    .fill(tone.color)
                    .frame(width: proxy.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: 8)
        .animation(HMMotion.spring, value: value)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int((min(max(value, 0), 1) * 100).rounded())) percent")
    }
}

/// Single-value meter ring that sweeps in when it appears.
struct ProgressRing<Label: View>: View {
    let value: Double
    var tone: Tone = .green
    var lineWidth: CGFloat = 10
    let accessibilityText: String
    @ViewBuilder var label: () -> Label

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(HM.Colors.separator, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: shown)
                .stroke(tone.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            label()
        }
        .onAppear { animate(to: value) }
        .onChange(of: value) { _, newValue in animate(to: newValue) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityValue("\(Int((value * 100).rounded())) percent")
    }

    private func animate(to target: Double) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.9, dampingFraction: 0.85)) {
            shown = min(max(target, 0), 1)
        }
    }
}
