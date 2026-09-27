import SwiftUI
import UIKit

/// "Mate" — HealthMate's AI assistant character, drawn in vector so the app
/// never depends on stock art. It is deliberately a friendly companion rather
/// than a clinician, so the UI never implies the AI is a doctor.
///
/// To use final artwork, add an image set named `Mascot` to Assets.xcassets —
/// it replaces the vector drawing everywhere automatically.
struct MascotView: View {
    var size: CGFloat = 160
    /// Idle float, blink and wave. Automatically off with Reduce Motion.
    var animated = true
    var withBackdrop = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    @State private var waving = false
    @State private var blinking = false

    private var shouldAnimate: Bool { animated && !reduceMotion }

    var body: some View {
        Group {
            if UIImage(named: "Mascot") != nil {
                Image("Mascot").resizable().scaledToFit()
            } else {
                drawing
            }
        }
        .frame(width: size, height: size)
        .offset(y: floating ? -size * 0.03 : size * 0.02)
        .accessibilityElement()
        .accessibilityLabel("HealthMate, your AI health assistant")
        .task(id: shouldAnimate) { await runIdleAnimations() }
    }

    // All geometry is laid out on a 200×200 canvas and scaled to `size`.
    private var drawing: some View {
        ZStack {
            if withBackdrop { backdrop }

            // antenna + heart
            Capsule().fill(Color(hex: 0x9DB6F5)).frame(width: 4, height: 14).position(x: 100, y: 32)
            Image(systemName: "heart.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color(hex: 0xF0605A))
                .position(x: 100, y: 24)

            // arms
            Capsule().fill(Color(hex: 0xC9D7FB)).frame(width: 12, height: 30)
                .rotationEffect(.degrees(38))
                .position(x: 54, y: 158)
            Group {
                Capsule().fill(Color(hex: 0xC9D7FB)).frame(width: 12, height: 30).position(x: 146, y: 136)
                Circle().fill(Color(hex: 0xF4F7FF)).overlay(Circle().stroke(Color(hex: 0xC9D7FB), lineWidth: 2))
                    .frame(width: 16, height: 16).position(x: 146, y: 118)
            }
            .rotationEffect(.degrees(waving ? -18 : 14), anchor: UnitPoint(x: 0.68, y: 0.76))

            // body + heart-pulse emblem
            UnevenRoundedRectangle(topLeadingRadius: 38, bottomLeadingRadius: 12, bottomTrailingRadius: 12, topTrailingRadius: 38, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0xF7F9FF), Color(hex: 0xD9E4FF)], startPoint: .top, endPoint: .bottom))
                .overlay(
                    UnevenRoundedRectangle(topLeadingRadius: 38, bottomLeadingRadius: 12, bottomTrailingRadius: 12, topTrailingRadius: 38, style: .continuous)
                        .stroke(Color(hex: 0xC9D7FB), lineWidth: 2)
                )
                .frame(width: 76, height: 64)
                .position(x: 100, y: 150)
            Circle().fill(Color(hex: 0x2F64EC)).frame(width: 28, height: 28).position(x: 100, y: 153)
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .position(x: 100, y: 153)

            // ear pods
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: 0xBFD0FA)).frame(width: 12, height: 28).position(x: 44, y: 82)
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: 0xBFD0FA)).frame(width: 12, height: 28).position(x: 156, y: 82)

            // head
            RoundedRectangle(cornerRadius: 40, style: .continuous)
                .fill(LinearGradient(colors: [.white, Color(hex: 0xE3EBFF)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).stroke(Color(hex: 0xC9D7FB), lineWidth: 2))
                .frame(width: 108, height: 86)
                .position(x: 100, y: 81)

            // visor
            RoundedRectangle(cornerRadius: 27, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0x253A74), Color(hex: 0x1A2650)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 84, height: 58)
                .position(x: 100, y: 81)

            // eyes (blink by squashing vertically)
            ForEach([84.0, 116.0], id: \.self) { x in
                Capsule().fill(Color(hex: 0x9FE3FF))
                    .frame(width: 10, height: 17)
                    .scaleEffect(x: 1, y: blinking ? 0.12 : 1)
                    .position(x: x, y: 76.5)
                Circle().fill(.white).frame(width: 4, height: 4)
                    .opacity(blinking ? 0 : 1)
                    .position(x: x + 2, y: 72)
            }

            // cheeks
            Ellipse().fill(Color(hex: 0xFF8FA3).opacity(0.55)).frame(width: 12, height: 7).position(x: 72, y: 92)
            Ellipse().fill(Color(hex: 0xFF8FA3).opacity(0.55)).frame(width: 12, height: 7).position(x: 128, y: 92)

            // smile
            Path { p in
                p.move(to: CGPoint(x: 91, y: 92))
                p.addQuadCurve(to: CGPoint(x: 109, y: 92), control: CGPoint(x: 100, y: 100))
            }
            .stroke(Color(hex: 0x9FE3FF), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        .frame(width: 200, height: 200)
        .scaleEffect(size / 200)
        .frame(width: size, height: size)
    }

    private var backdrop: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Color(hex: 0xCFDCFF, opacity: 0.9), Color(hex: 0xCFDCFF, opacity: 0)], center: .center, startRadius: 0, endRadius: 96))
                .frame(width: 192, height: 192)
                .position(x: 100, y: 104)
            Image(systemName: "sparkle").font(.system(size: 14)).foregroundStyle(Color(hex: 0xB9A8FF)).position(x: 34, y: 58)
            Image(systemName: "sparkle").font(.system(size: 10)).foregroundStyle(Color(hex: 0x8FB0FF)).position(x: 166, y: 44)
            Circle().fill(Color(hex: 0x8FB0FF)).frame(width: 6, height: 6).position(x: 172, y: 120)
        }
    }

    @MainActor
    private func runIdleAnimations() async {
        guard shouldAnimate else {
            floating = false
            waving = false
            blinking = false
            return
        }
        withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) { floating = true }
        withAnimation(.easeInOut(duration: 0.45).repeatCount(4, autoreverses: true)) { waving = true }
        // Blink every few seconds until the view disappears (task is cancelled).
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Double.random(in: 2.5...4.5)))
            if Task.isCancelled { break }
            withAnimation(.easeInOut(duration: 0.08)) { blinking = true }
            try? await Task.sleep(for: .milliseconds(140))
            withAnimation(.easeInOut(duration: 0.1)) { blinking = false }
        }
    }
}

/// HealthMate logo mark: a heart with a pulse line.
struct LogoMark: View {
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            Image(systemName: "heart.fill")
                .font(.system(size: size))
                .foregroundStyle(LinearGradient(colors: [Color(hex: 0x5B8CFF), Color(hex: 0x2F64EC)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: size * 0.42, weight: .heavy))
                .foregroundStyle(.white)
                .offset(y: -size * 0.03)
        }
        .accessibilityHidden(true)
    }
}
