import Foundation

/// Guidance for taking a photo to check. Same content on web (apps/web/src/lib/photo-check.ts).
public enum PhotoCheck {
    public static let captureTips = [
        "Use daylight or a bright room, and avoid flash glare.",
        "Hold the phone steady, about a hand's length away.",
        "Keep the area in focus and filling most of the frame.",
        "Leave out your face and anything else that identifies you.",
    ]

    /// Shown before any photo is taken: a photo check is never the route for an emergency.
    public static let getHelpNow = "If there's heavy bleeding, trouble breathing, swelling of the face, lips or throat, or you feel very unwell, call your local emergency number now — don't wait for a photo check."

    public static let uploadSteps = ["Uploading securely", "Looking at the photo", "Writing what we can see"]

    /// Emergency or urgent guidance for a note, shown before anything is sent (nil otherwise).
    public static func escalation(forNote note: String) -> Escalation? {
        let result = SafetyEngine.triage(note)
        guard result.level == .emergency || result.level == .urgent else { return nil }
        return SafetyEngine.escalation(for: result)
    }
}

extension ImagePurpose {
    public var detail: String {
        switch self {
        case .skin: "A rash, spot, mole or patch of skin"
        case .wound: "A cut, graze, burn or healing wound"
        case .swelling: "A swollen or bruised area"
        case .other: "Another visible concern"
        }
    }

    public var tip: String {
        switch self {
        case .skin: "Show the whole rash or spot, not just part of it."
        case .wound: "Show the whole wound and a little of the skin around it."
        case .swelling: "If one side is affected, a second photo of the other side helps you compare later."
        case .other: "Show the area clearly with a little context around it."
        }
    }
}
