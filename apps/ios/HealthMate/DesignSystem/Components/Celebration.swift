import SwiftUI

/// A short, soft confetti burst — played when the day's plan is completed.
struct CelebrationBurst: View {
    /// Increment to fire the burst.
    let trigger: Int
    @State private var particles: [Particle] = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Particle: Identifiable {
        let id = UUID()
        let color: Color
        let angle: Double
        let distance: CGFloat
        let size: CGFloat
        var launched = false
    }

    private let palette: [Color] = [HM.Colors.primary, HM.Colors.success, HM.Colors.purple, HM.Colors.warning, HM.Colors.teal]

    var body: some View {
        ZStack {
            ForEach(particles) { p in
                Circle()
                    .fill(p.color)
                    .frame(width: p.size, height: p.size)
                    .offset(
                        x: p.launched ? CGFloat(cos(p.angle)) * p.distance : 0,
                        y: p.launched ? CGFloat(sin(p.angle)) * p.distance : 0
                    )
                    .opacity(p.launched ? 0 : 1)
                    .scaleEffect(p.launched ? 0.4 : 1)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) { _, _ in fire() }
    }

    private func fire() {
        guard !reduceMotion else { return }
        particles = (0..<22).map { i in
            Particle(
                color: palette[i % palette.count],
                angle: Double(i) / 22 * 2 * .pi + Double.random(in: -0.15...0.15),
                distance: CGFloat.random(in: 50...110),
                size: CGFloat.random(in: 5...9)
            )
        }
        withAnimation(.easeOut(duration: 0.9)) {
            for i in particles.indices { particles[i].launched = true }
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            particles.removeAll()
        }
    }
}
