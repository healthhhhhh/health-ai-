import Foundation

/// Every non-content state a screen or section can be in. Copy matches the
/// web `StateView` so both apps say the same thing.
public enum ScreenState: String, CaseIterable, Sendable, Identifiable {
    case loading, processing, empty, error, offline, permission, success

    public var id: String { rawValue }

    public var systemImage: String {
        switch self {
        case .loading: return "hourglass"
        case .processing: return "arrow.triangle.2.circlepath"
        case .empty: return "tray"
        case .error: return "exclamationmark.triangle"
        case .offline: return "wifi.slash"
        case .permission: return "lock"
        case .success: return "checkmark.circle"
        }
    }

    public var tone: Tone {
        switch self {
        case .loading, .processing, .empty: return .blue
        case .error, .offline: return .orange
        case .permission: return .purple
        case .success: return .green
        }
    }

    public var defaultTitle: String {
        switch self {
        case .loading: return "Loading…"
        case .processing: return "Working on it…"
        case .empty: return "Nothing here yet"
        case .error: return "Something went wrong"
        case .offline: return "You're offline"
        case .permission: return "Access is turned off"
        case .success: return "All done"
        }
    }

    public var defaultMessage: String {
        switch self {
        case .loading: return "This usually takes a moment."
        case .processing: return "You can leave this screen — we'll keep going."
        case .empty: return "When you add something, it will appear here."
        case .error: return "We couldn't load this. Please try again."
        case .offline: return "Check your connection. We'll show your information again as soon as you're back online."
        case .permission: return "Turn access on to use this feature. You can change it at any time."
        case .success: return "Your changes were saved."
        }
    }

    /// Errors interrupt (VoiceOver announces them); other states are polite.
    public var isUrgent: Bool { self == .error || self == .offline }

    /// The state to show for a failed request.
    public static func from(_ error: Error) -> ScreenState {
        if let api = error as? APIError, api == .network { return .offline }
        if let data = error as? HealthDataError, data == .network { return .offline }
        return .error
    }
}

/// Where a health fact came from — shown next to every fact (CLAUDE.md).
/// Labels match the web `SourceBadge`.
public enum Provenance: String, CaseIterable, Sendable {
    case userReported = "user_reported"
    case userConfirmed = "user_confirmed"
    case clinicianProvided = "clinician_provided"
    case documentExtracted = "document_extracted"
    case healthkit
    case appleHealth = "apple_health"
    case device
    case aiInferred = "ai_inferred"
    case sample

    public var label: String {
        switch self {
        case .userReported: return "You added this"
        case .userConfirmed: return "Confirmed by you"
        case .clinicianProvided: return "From your clinician"
        case .documentExtracted: return "From a report"
        case .healthkit, .appleHealth: return "From Apple Health"
        case .device: return "From a device"
        // AI inferences are never shown as fact.
        case .aiInferred: return "Unconfirmed · AI suggestion"
        case .sample: return "Sample"
        }
    }

    public var tone: Tone {
        switch self {
        case .userReported: return .blue
        case .userConfirmed: return .green
        case .clinicianProvided: return .teal
        case .documentExtracted: return .blue
        case .healthkit, .appleHealth, .device: return .red
        case .aiInferred: return .purple
        case .sample: return .orange
        }
    }
}

/// Notification categories: icon, tone and settings label (matches the web).
public enum NotificationCategory: String, CaseIterable, Sendable, Codable {
    case medication, task, appointment, report, insight, account

    public var label: String {
        switch self {
        case .medication: return "Medication reminders"
        case .task: return "Tasks & habits"
        case .appointment: return "Appointments"
        case .report: return "Reports & photos"
        case .insight: return "Insights"
        case .account: return "Account & security"
        }
    }

    public var systemImage: String {
        switch self {
        case .medication: return "pills"
        case .task: return "checklist"
        case .appointment: return "calendar.badge.clock"
        case .report: return "doc.text"
        case .insight: return "sparkles"
        case .account: return "lock.shield"
        }
    }

    public var tone: Tone {
        switch self {
        case .medication: return .blue
        case .task: return .green
        case .appointment: return .teal
        case .report, .insight: return .purple
        case .account: return .orange
        }
    }
}
