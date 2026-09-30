import Foundation

/// What an AI answer was based on, in plain words, for the "AI-generated ·
/// based on …" label (CLAUDE.md: AI content shows what it was based on).
/// Mirrors apps/web/src/lib/ai-basis.ts.
public enum AIBasis {
    private static let metricNames: [String: String] = [
        "sleep": "sleep", "steps": "steps", "active_energy": "activity", "heart_rate": "heart rate",
        "resting_heart_rate": "resting heart rate", "weight": "weight", "blood_pressure_systolic": "blood pressure",
        "blood_pressure_diastolic": "blood pressure", "blood_glucose": "blood glucose", "water": "water",
    ]

    private static func list(_ parts: [String]) -> String {
        guard parts.count > 1, let last = parts.last else { return parts.first ?? "" }
        return parts.dropLast().joined(separator: ", ") + " and " + last
    }

    /// Nil when nothing from the person's record was used.
    public static func describe(_ context: AnswerContext?) -> String? {
        guard let context else { return nil }
        var parts: [String] = []
        let count = context.memories.count
        if count > 0 { parts.append(count == 1 ? "1 thing from your health memory" : "\(count) things from your health memory") }
        if context.usedProfile { parts.append("your health profile") }
        var metrics: [String] = []
        for kind in context.healthMetrics {
            let name = metricNames[kind] ?? kind
            if !metrics.contains(name) { metrics.append(name) }
        }
        if !metrics.isEmpty { parts.append("your \(list(metrics)) data") }
        return parts.isEmpty ? nil : list(parts)
    }
}
