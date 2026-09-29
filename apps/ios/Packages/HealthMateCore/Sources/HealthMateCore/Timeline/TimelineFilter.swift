import Foundation

/// Timeline filters, the same on web (apps/web/src/lib/timeline.ts).
public enum TimelineFilter: String, CaseIterable, Identifiable, Sendable {
    case all, reports, conversations, symptoms, medications, readings, appointments, notes

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: "All"
        case .reports: "Reports & photos"
        case .conversations: "Conversations"
        case .symptoms: "Symptoms"
        case .medications: "Medications"
        case .readings: "Readings"
        case .appointments: "Appointments"
        case .notes: "Notes"
        }
    }

    /// Event types this filter shows (empty = everything).
    public var eventTypes: [String] {
        switch self {
        case .all: []
        case .reports: ["report", "image"]
        case .conversations: ["chat"]
        case .symptoms: ["symptom"]
        case .medications: ["medication"]
        case .readings: ["measurement"]
        case .appointments: ["appointment"]
        case .notes: ["note"]
        }
    }

    /// What to say when the filter has nothing.
    public var emptyMessage: String {
        switch self {
        case .all: "Reports you upload, conversations and anything you add will appear here in order."
        case .reports: "Reports and photos you upload appear here."
        case .conversations: "Conversations with the AI Health Assistant appear here."
        case .symptoms: "Symptoms you log appear here."
        case .medications: "Medications you take from your plan appear here."
        case .readings: "Readings from Apple Health or that you add appear here."
        case .appointments: "Appointments you add appear here."
        case .notes: "Notes you add appear here."
        }
    }
}

extension TimelineEventRecord {
    /// Only entries the person added can be edited or deleted (never documents, devices or clinicians).
    public var isEditable: Bool { sourceType == "user_entered" && eventType != "chat" && eventType != "measurement" }

    /// Free-text details saved with the entry, if any.
    public var details: String? { payload?["details"].string }
}
