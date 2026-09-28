import Foundation

/// On-device escalation copy, identical to packages/safety `escalationMessage`.
/// Shown immediately — before (and regardless of) any network call.
extension SafetyEngine {
    public static func escalation(for result: TriageResult) -> Escalation? {
        switch result.level {
        case .emergency where result.isMentalHealthCrisis:
            return Escalation(
                level: .emergency,
                title: "You don't have to go through this alone",
                body: "If you might act on thoughts of harming yourself, call your local emergency number now. You can also contact a crisis line in your country — they're free, confidential and there to listen.",
                actions: [
                    EscalationAction(kind: .callEmergency, label: "Call emergency services"),
                    EscalationAction(kind: .crisisSupport, label: "Find a crisis line"),
                ]
            )
        case .emergency:
            return Escalation(
                level: .emergency,
                title: "This could be an emergency",
                body: "\(result.reasons.joined(separator: " ")) Call your local emergency number now, or have someone take you to the nearest emergency department. Don't wait to see if it passes.",
                actions: [
                    EscalationAction(kind: .callEmergency, label: "Call emergency services"),
                    EscalationAction(kind: .findCare, label: "Find the nearest emergency department"),
                ]
            )
        case .urgent:
            return Escalation(
                level: .urgent,
                title: "Please get checked today",
                body: "\(result.reasons.joined(separator: " ")) Contact a doctor or an urgent-care service today. If things get worse, call your local emergency number.",
                actions: [
                    EscalationAction(kind: .contactClinician, label: "Contact a clinician"),
                    EscalationAction(kind: .findCare, label: "Find urgent care"),
                ]
            )
        default:
            return nil
        }
    }

    /// Well-known public emergency numbers by region; 112 works on most mobile
    /// networks worldwide and is the fallback.
    public static func emergencyNumber(regionCode: String?) -> String {
        switch regionCode?.uppercased() {
        case "US", "CA", "MX", "PR": return "911"
        case "GB", "IE", "HK", "MY": return "999"
        case "SG": return "995"
        case "AU": return "000"
        case "NZ": return "111"
        case "JP", "KR": return "119"
        default: return "112"
        }
    }
}

extension Escalation {
    public init(level: TriageLevel, title: String, body: String, actions: [EscalationAction]) {
        self.level = level
        self.title = title
        self.body = body
        self.actions = actions
    }
}

extension EscalationAction {
    public init(kind: Kind, label: String) {
        self.kind = kind
        self.label = label
    }
}
