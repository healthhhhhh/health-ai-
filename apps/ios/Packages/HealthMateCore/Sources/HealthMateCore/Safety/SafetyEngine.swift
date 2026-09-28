import Foundation

/// Mirrors packages/safety (TypeScript). The rules themselves are generated
/// from the TypeScript source into SafetyRules.generated.swift, so both
/// platforms apply exactly the same checks.
public enum TriageLevel: String, Codable, Sendable, Comparable, CaseIterable {
    case informational, routine, urgent, emergency

    private var rank: Int {
        switch self {
        case .informational: return 0
        case .routine: return 1
        case .urgent: return 2
        case .emergency: return 3
        }
    }

    public static func < (lhs: TriageLevel, rhs: TriageLevel) -> Bool { lhs.rank < rhs.rank }
}

public struct SymptomRule: Sendable {
    public let id: String
    public let level: TriageLevel
    public let category: String
    public let allOf: [[String]]
    public let reason: String
}

public struct TriageResult: Equatable, Sendable {
    public let level: TriageLevel
    public let matchedRuleIDs: [String]
    public let reasons: [String]
    public let categories: Set<String>
    public let medicationChangeRequest: Bool

    public var needsEscalation: Bool { level >= .urgent }
    public var isMentalHealthCrisis: Bool { categories.contains("mental_health_crisis") }
}

/// Deterministic, on-device safety checks. Runs before any network call so
/// emergency guidance appears instantly and works offline.
public enum SafetyEngine {
    private struct CompiledRule: @unchecked Sendable {
        let rule: SymptomRule
        let groups: [[NSRegularExpression]]
    }

    private static func compile(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    nonisolated(unsafe) private static let compiledRules: [CompiledRule] = SafetyRules.symptomRules.map { rule in
        CompiledRule(rule: rule, groups: rule.allOf.map { $0.compactMap(compile) })
    }
    nonisolated(unsafe) private static let medicationPatterns = SafetyRules.medicationChangePatterns.compactMap(compile)
    nonisolated(unsafe) private static let injectionPatterns = SafetyRules.promptInjectionPatterns.compactMap(compile)

    public static func normalize(_ text: String) -> String {
        var s = text
        for ch in ["\u{2018}", "\u{2019}", "\u{02BC}"] { s = s.replacingOccurrences(of: ch, with: "'") }
        for ch in ["\u{201C}", "\u{201D}"] { s = s.replacingOccurrences(of: ch, with: "\"") }
        return s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static func isNegated(_ text: String, before range: NSRange) -> Bool {
        let ns = text as NSString
        let start = max(0, range.location - 24)
        let window = ns.substring(with: NSRange(location: start, length: range.location - start)).lowercased()
        let negation = try? NSRegularExpression(pattern: #"\b(no|not|without|denies|never|don'?t have|doesn'?t have)\s+(any\s+)?$"#)
        return negation?.firstMatch(in: window, range: NSRange(location: 0, length: (window as NSString).length)) != nil
    }

    private static func groupMatches(_ text: String, _ patterns: [NSRegularExpression], allowNegation: Bool) -> Bool {
        let full = NSRange(location: 0, length: (text as NSString).length)
        return patterns.contains { pattern in
            guard let match = pattern.firstMatch(in: text, range: full) else { return false }
            return !allowNegation || !isNegated(text, before: match.range)
        }
    }

    public static func triage(_ input: String) -> TriageResult {
        let text = normalize(input)
        let matched = compiledRules.filter { compiled in
            compiled.groups.allSatisfy { groupMatches(text, $0, allowNegation: compiled.rule.category != "mental_health_crisis") }
        }
        let level = matched.map(\.rule.level).max() ?? .routine
        let full = NSRange(location: 0, length: (text as NSString).length)
        return TriageResult(
            level: max(level, .routine),
            matchedRuleIDs: matched.map(\.rule.id),
            reasons: matched.filter { $0.rule.level == level }.map(\.rule.reason),
            categories: Set(matched.map(\.rule.category)),
            medicationChangeRequest: medicationPatterns.contains { $0.firstMatch(in: text, range: full) != nil }
        )
    }

    public static func detectPromptInjection(_ input: String) -> Bool {
        let text = normalize(input)
        let full = NSRange(location: 0, length: (text as NSString).length)
        return injectionPatterns.contains { $0.firstMatch(in: text, range: full) != nil }
    }

    public static let medicationChangeNotice = "HealthMate can't advise starting, stopping or changing a medication or dose. Please talk to the clinician who prescribed it or a pharmacist before making any change."
}
