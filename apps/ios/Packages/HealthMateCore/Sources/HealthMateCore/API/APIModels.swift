import Foundation

// Codable mirrors of services/api responses.

public struct TokenPair: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
}

public struct AuthResponse: Codable, Sendable {
    public let userId: String
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public var tokens: TokenPair { TokenPair(accessToken: accessToken, refreshToken: refreshToken, expiresIn: expiresIn) }
}

/// Result of creating an account. With email confirmation turned on (Supabase),
/// there is no session until the person opens the link in their inbox.
public enum RegisterOutcome: Equatable, Sendable {
    case signedIn(userId: String)
    case confirmationRequired
}

/// Wire shape of `POST /v1/auth/register` (200 with tokens, or 202 `{ confirmationRequired: true }`).
struct RegisterWire: Decodable {
    let userId: String?
    let accessToken: String?
    let refreshToken: String?
    let expiresIn: Int?
    let confirmationRequired: Bool?
}

/// A short-lived signed link to download an uploaded original.
public struct DocumentFileLink: Codable, Equatable, Sendable {
    public let url: URL
    public let expiresIn: Int
}

public struct APIMeta: Codable, Sendable {
    public struct AI: Codable, Sendable {
        public let available: Bool
        /// Scripted demo answers, not a real model (demo server only).
        public let demo: Bool?
        /// Outside AI companies that receive data, named on consent screens (absent from older servers and Preview).
        public let recipients: [String]?
    }
    /// How the server handles age. With "enforce" (production) only in-scope accounts may use health features.
    public struct Age: Codable, Sendable {
        /// "off", "record" or "enforce".
        public let enforcement: String
        public let enabledBands: [AgeBand]
        /// Always false: parental consent doesn't exist (under-13s are never served).
        public let parentalConsent: Bool
    }
    public let apiVersion: Int
    public let ai: AI
    /// Phase 1 Preview mode: sample account, no backend.
    public let preview: Bool?
    /// `nil` from older servers and Preview.
    public var age: Age? = nil
}

// MARK: Age (computed by the server; enforced when the server's age enforcement is "enforce")

/// An account's age band, computed by the server. Values this app doesn't know decode as `.unknown`.
public enum AgeBand: String, Codable, Sendable, CaseIterable {
    case unknown
    case under13 = "under_13"
    case age13to15 = "13_15"
    case age16to17 = "16_17"
    case adult

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgeBand(rawValue: raw) ?? .unknown
    }
}

/// Where the band sits relative to the bands the product serves.
/// Values this app doesn't know decode as `.unknown`.
public enum AgeStatus: String, Codable, Sendable, CaseIterable {
    case unknown
    case inScope = "in_scope"
    case blockedUnder13 = "blocked_under_13"
    case blockedOutOfScope = "blocked_out_of_scope"
    case review

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgeStatus(rawValue: raw) ?? .unknown
    }
}

/// What the server enforces now. The restricted values are also the `error.code` of the
/// 403 a restricted account gets. Values this app doesn't know decode as `.unknown`.
public enum AgeEligibility: String, Codable, Sendable, CaseIterable {
    case eligible
    case ageRequired = "age_required"
    case ageReview = "age_review"
    case ageNotEligible = "age_not_eligible"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgeEligibility(rawValue: raw) ?? .unknown
    }
}

/// `POST /v1/me/age` result. The band is the server's; the client only sends a date of birth.
public struct AgeAssessment: Codable, Equatable, Sendable {
    public let ageBand: AgeBand
    public let ageStatus: AgeStatus
    public let assessedAt: Date
    /// "applied", or "review" when it claimed an older band than the one on record (which was kept).
    public let outcome: String
    /// `nil` from older servers.
    public var eligibility: AgeEligibility? = nil
    /// Set when the account was found to belong to someone under 13; it is deleted then.
    public var deletionScheduledAt: Date? = nil
}

// MARK: Profile

public enum ProfileSource: String, Codable, Sendable, CaseIterable {
    case userReported = "user_reported"
    case clinicianProvided = "clinician_provided"
    case documentExtracted = "document_extracted"

    public var label: String {
        switch self {
        case .userReported: return "Added by you"
        case .clinicianProvided: return "From your clinician"
        case .documentExtracted: return "From a report"
        }
    }
}

public struct ProfileDetails: Codable, Equatable, Sendable {
    public var firstName: String
    public var lastName: String
    public var dateOfBirth: String?
    public var sex: String?
    public var heightCm: Double?
    public var timeZone: String
    /// What the person wants help with (onboarding); ids from `HealthGoal`.
    public var goals: [String]?
    /// Preferred units, stored with the account (Phase 2A). `nil` from older servers and Preview.
    public var unitSystem: UnitSystem? = nil
}

public enum UnitSystem: String, Codable, Sendable {
    case metric, imperial
}

/// Sign-in details for the account (not health data).
public struct AccountSummary: Codable, Equatable, Sendable {
    public let email: String
    public let emailVerified: Bool
    public let signInMethods: [String]
    public let createdAt: Date
    public let onboardingCompleted: Bool
    /// The name given at sign-up (readable before the age check, unlike the health profile). `nil` from older servers.
    public var firstName: String? = nil
    public var lastName: String? = nil
    /// `nil` from older servers and Preview.
    public var ageBand: AgeBand? = nil
    public var ageStatus: AgeStatus? = nil
    public var ageAssessedAt: Date? = nil
    public var ageEligibility: AgeEligibility? = nil
    /// Set when the account was found to belong to someone under 13.
    public var ageDeletionScheduledAt: Date? = nil
}

/// A device registered for push notifications (`/v1/me/devices`, Phase 2D).
/// The token itself is write-only: the server never returns it.
public struct PushDevice: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let platform: String
    /// "sandbox" (development builds) or "production".
    public let environment: String
    public let appVersion: String?
    public let createdAt: Date
    public let lastRegisteredAt: Date
    /// false once the push service reported the token as no longer valid.
    public let active: Bool
}

public struct PushDeviceList: Codable, Equatable, Sendable {
    public let devices: [PushDevice]
}

/// Which reminders and updates the person wants, and how private they are.
public struct NotificationPreferences: Codable, Equatable, Sendable {
    public struct QuietHours: Codable, Equatable, Sendable {
        public var enabled: Bool
        public var start: String
        public var end: String
        public init(enabled: Bool, start: String, end: String) {
            self.enabled = enabled
            self.start = start
            self.end = end
        }
    }

    public var medication: Bool
    public var task: Bool
    public var appointment: Bool
    public var report: Bool
    public var insight: Bool
    public var account: Bool
    /// Show health details on the lock screen / in notification previews.
    public var showDetails: Bool
    public var quietHours: QuietHours

    public init(medication: Bool = true, task: Bool = true, appointment: Bool = true, report: Bool = true, insight: Bool = true, account: Bool = true, showDetails: Bool = false, quietHours: QuietHours = QuietHours(enabled: false, start: "22:00", end: "07:00")) {
        self.medication = medication
        self.task = task
        self.appointment = appointment
        self.report = report
        self.insight = insight
        self.account = account
        self.showDetails = showDetails
        self.quietHours = quietHours
    }
}

// Structured facts carry their event dates (YYYY-MM-DD) from Phase 2A; the
// fields are optional so older servers and Preview mode still decode.
// See docs/health-memory-architecture.md.

public struct ConditionRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let status: String
    public let source: ProfileSource
    public let notes: String?
    public var onsetOn: String? = nil
    /// Resolved conditions are history, never "current".
    public var resolvedOn: String? = nil
    public var sourceRef: String? = nil
}

public struct AllergyRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let substance: String
    public let reaction: String?
    public let severity: String?
    public let source: ProfileSource
    /// "active" or "inactive".
    public var status: String? = nil
    public var notedOn: String? = nil
    public var sourceRef: String? = nil
}

/// `instruction` is the clinician's or label's wording, exactly as entered.
public struct MedicationRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let instruction: String
    public let source: ProfileSource
    public let active: Bool
    public var startedOn: String? = nil
    /// A stopped medication is history (with its stop date), not a correction.
    public var stoppedOn: String? = nil
    public var sourceRef: String? = nil
}

public struct HealthProfile: Codable, Equatable, Sendable {
    public var profile: ProfileDetails
    public var conditions: [ConditionRecord]
    public var allergies: [AllergyRecord]
    public var medications: [MedicationRecord]
}

// MARK: Memory

public enum MemoryStatus: String, Codable, Sendable {
    case userReported = "user_reported"
    case userConfirmed = "user_confirmed"
    case documentExtracted = "document_extracted"
    case healthkit
    /// Older servers' name for `healthkit`.
    case wearable
    case clinicianProvided = "clinician_provided"
    case aiInferred = "ai_inferred"
    case superseded

    /// AI-inferred facts are never presented as confirmed history.
    public var label: String {
        switch self {
        case .userReported: return "You told HealthMate"
        case .userConfirmed: return "Confirmed by you"
        case .documentExtracted: return "From a report"
        case .healthkit, .wearable: return "From Apple Health"
        case .clinicianProvided: return "From your clinician"
        case .aiInferred: return "Unconfirmed suggestion"
        case .superseded: return "Replaced"
        }
    }
}

public struct MemoryRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let fact: String
    public let source: String
    public let status: MemoryStatus
    public let createdAt: Date
    /// When it happened / was true (YYYY-MM-DD), when known.
    public var occurredOn: String? = nil
    /// When it stopped being true (YYYY-MM-DD).
    public var endedOn: String? = nil
    public var category: String? = nil
    /// A correction replaced this fact; `priorStatus` keeps where it originally came from.
    public var supersededBy: String? = nil
    public var priorStatus: MemoryStatus? = nil
    /// Phase 2C: "current", "historical" (ended) or "superseded" (corrected).
    public var temporalStatus: String? = nil
    /// Kept, but never given to the AI Health Assistant.
    public var aiExcluded: Bool? = nil
    public var lastUsedAt: Date? = nil
    public var isPast: Bool { temporalStatus == "historical" }
}

// MARK: Chat

public struct EscalationAction: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case callEmergency = "call_emergency", crisisSupport = "crisis_support", contactClinician = "contact_clinician", findCare = "find_care" }
    public let kind: Kind
    public let label: String

    public init(kind: Kind, label: String) {
        self.kind = kind
        self.label = label
    }
}

public struct Escalation: Codable, Equatable, Sendable {
    public let level: TriageLevel
    public let title: String
    public let body: String
    public let actions: [EscalationAction]

    public init(level: TriageLevel, title: String, body: String, actions: [EscalationAction]) {
        self.level = level
        self.title = title
        self.body = body
        self.actions = actions
    }
}

public struct FollowUpQuestion: Codable, Equatable, Sendable {
    public let question: String
    public let options: [String]
    public let allowsMultiple: Bool
}

public struct CareRecommendation: Codable, Equatable, Sendable {
    public enum Level: String, Codable, Sendable { case selfCare = "self_care", routine, soon, urgent, emergency }
    public let level: Level
    public let text: String
}

public struct AssistantAnswer: Codable, Equatable, Sendable {
    public let answer: String
    public let followUp: FollowUpQuestion?
    public let warningSigns: [String]
    public let careRecommendation: CareRecommendation?
    public let memorySuggestions: [MemorySuggestion]
    public let escalation: Escalation?
    public let notice: String?
    public let safetyAdjusted: Bool
    /// Phase 2C: what the answer was based on (nil from older servers and Preview).
    public var context: AnswerContext? = nil

    public struct MemorySuggestion: Codable, Equatable, Sendable { public let fact: String }
}

/// The few facts and data an answer used — never the whole history.
public struct AnswerContext: Codable, Equatable, Sendable {
    public struct UsedMemory: Codable, Equatable, Sendable {
        public let id: String
        public let fact: String
        /// "current" or "historical".
        public let temporalStatus: String
        public let occurredOn: String?
    }
    public let memories: [UsedMemory]
    public let usedProfile: Bool
    /// Daily health metrics summarised for the answer, e.g. "sleep".
    public let healthMetrics: [String]

    public init(memories: [UsedMemory], usedProfile: Bool, healthMetrics: [String]) {
        self.memories = memories
        self.usedProfile = usedProfile
        self.healthMetrics = healthMetrics
    }
}

public enum AssistantPayload: Codable, Equatable, Sendable {
    case escalation(Escalation)
    case answer(AssistantAnswer)

    private enum CodingKeys: String, CodingKey { case kind, escalation }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "escalation": self = .escalation(try container.decode(Escalation.self, forKey: .escalation))
        default: self = .answer(try AssistantAnswer(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .escalation(let e):
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode("escalation", forKey: .kind)
            try c.encode(e, forKey: .escalation)
        case .answer(let a):
            try a.encode(to: encoder)
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode("answer", forKey: .kind)
        }
    }
}

public struct ChatMessageRecord: Codable, Equatable, Identifiable, Sendable {
    public enum Role: String, Codable, Sendable { case user, assistant }
    public let id: String
    public let role: Role
    public let content: String
    public let payload: AssistantPayload?
    public let triageLevel: TriageLevel?
    public let createdAt: Date
}

public struct ConversationRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let createdAt: Date
    public let updatedAt: Date
}

public struct ConversationStart: Codable, Sendable {
    public let conversation: ConversationRecord
    public let messages: [ChatMessageRecord]
}

public struct ConversationDetail: Codable, Sendable {
    public let conversation: ConversationRecord
    public let messages: [ChatMessageRecord]
}

public struct MessagesResponse: Codable, Sendable {
    public let messages: [ChatMessageRecord]
}

// MARK: Documents

public enum DocumentKind: String, Codable, Sendable { case report, image }
public enum DocumentStatus: String, Codable, Sendable { case awaitingUpload = "awaiting_upload", processing, ready, failed }
public enum ImagePurpose: String, Codable, Sendable, CaseIterable, Identifiable {
    case skin, wound, swelling, other
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .skin: return "Skin or rash"
        case .wound: return "Cut or wound"
        case .swelling: return "Swelling or bruise"
        case .other: return "Something else"
        }
    }
}

public struct ReportFinding: Codable, Equatable, Sendable, Identifiable {
    public enum Flag: String, Codable, Sendable { case withinRange = "within_range", high, low, abnormal, notStated = "not_stated" }
    public let name: String
    public let value: String
    public let unit: String?
    public let referenceRange: String?
    public let flag: Flag
    public let page: Int?
    public let explanation: String
    public var id: String { "\(name)|\(value)|\(page ?? 0)" }
}

public struct PossibleCause: Codable, Equatable, Sendable {
    public enum Likelihood: String, Codable, Sendable { case possible, lessLikely = "less_likely" }
    public let name: String
    public let likelihood: Likelihood
}

/// Union of report and image results; `type` says which fields are meaningful.
public struct AnalysisResult: Codable, Equatable, Sendable {
    public let type: DocumentKind
    public let model: String
    public let injectionDetected: Bool
    // Report
    public let readable: Bool?
    public let documentType: String?
    public let summary: String?
    public let findings: [ReportFinding]?
    public let suggestedQuestions: [String]?
    // Image
    public let quality: String?
    public let qualityIssue: String?
    public let supported: Bool?
    public let bodyArea: String?
    public let observations: [String]?
    public let possibleCauses: [PossibleCause]?
    public let recommendations: [String]?
    public let warningSigns: [String]?
    public let careUrgency: CareRecommendation.Level?
}

public struct DocumentRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: DocumentKind
    public let purpose: ImagePurpose?
    public let filename: String
    public let contentType: String
    public let byteSize: Int
    public let status: DocumentStatus
    public let failureReason: String?
    public let result: AnalysisResult?
    public let createdAt: Date
    public let processedAt: Date?
}

public struct UploadInstructions: Codable, Sendable {
    public let method: String
    public let url: URL
    public let headers: [String: String]
}

public struct DocumentCreation: Codable, Sendable {
    public let document: DocumentRecord
    public let upload: UploadInstructions
}

// MARK: Health data & timeline

public struct TrendPoint: Codable, Equatable, Sendable, Identifiable {
    public let date: String
    public let value: Double
    public let min: Double
    public let max: Double
    public let count: Int
    public var id: String { date }
}

public struct TrendResponse: Codable, Equatable, Sendable {
    public let kind: String
    public let unit: String
    public let points: [TrendPoint]
    public let average: Double?
    public let previousAverage: Double?
}

public struct MeasurementUpload: Codable, Equatable, Sendable {
    public let kind: String
    public let value: Double
    public let recordedAt: Date
    public let source: String
    public let sourceDevice: String?
    public let externalId: String?

    public init(kind: String, value: Double, recordedAt: Date, source: String, sourceDevice: String?, externalId: String?) {
        self.kind = kind
        self.value = value
        self.recordedAt = recordedAt
        self.source = source
        self.sourceDevice = sourceDevice
        self.externalId = externalId
    }
}

public struct TimelineEventRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let eventType: String
    public let title: String
    public let occurredAt: Date
    public let sourceType: String
    public let sourceId: String?
    /// Extra details, e.g. `{ "kind": "sleep" }` for a synced measurement.
    public let payload: JSONValue?

    public init(id: String, eventType: String, title: String, occurredAt: Date, sourceType: String, sourceId: String?, payload: JSONValue? = nil) {
        self.id = id
        self.eventType = eventType
        self.title = title
        self.occurredAt = occurredAt
        self.sourceType = sourceType
        self.sourceId = sourceId
        self.payload = payload
    }
}

public struct TimelinePage: Codable, Sendable {
    public let events: [TimelineEventRecord]
    public let nextCursor: String?
}

public struct ConsentRecord: Codable, Equatable, Sendable {
    public let kind: String
    public let granted: Bool
    public let version: String
}

// MARK: Notifications & care

public struct NotificationRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let category: NotificationCategory
    public let title: String
    public let body: String
    public let createdAt: Date
    public var readAt: Date?
    /// In-app destination as a web path, e.g. "/reports/<id>" (see `AppRoute`).
    public let link: String?
    /// AI-written content is labelled in the UI.
    public let aiGenerated: Bool

    public var isRead: Bool { readAt != nil }
}

public struct NotificationList: Codable, Sendable {
    public let notifications: [NotificationRecord]
    public let unreadCount: Int
}

public struct AppointmentRecord: Codable, Equatable, Identifiable, Sendable {
    public enum Mode: String, Codable, Sendable { case inPerson = "in_person", video, phone }
    public enum Status: String, Codable, Sendable { case scheduled, completed, cancelled }

    public let id: String
    public let title: String
    public let careProviderId: String?
    public let providerName: String?
    public let startsAt: Date
    public let endsAt: Date?
    public let location: String?
    public let mode: Mode?
    public var status: Status
    public let notes: String?
}

public struct CareProviderRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let specialty: String?
    public let phone: String?
    public let address: String?
    public let website: String?
    public let notes: String?
}


// MARK: Daily health data & Apple Health connection (Phase 2B)

/// One day of one metric from the account (`GET /v1/health-data/daily`).
public struct DailyHealthRecord: Codable, Equatable, Sendable {
    public let day: String
    public let kind: String
    public let unit: String
    public let value: Double
    public let min: Double?
    public let max: Double?
    public let sampleCount: Int?
    /// "apple_health" or "user_entered".
    public let source: String
    /// false while the day is still in progress.
    public let isComplete: Bool
    public let timeZone: String
}

/// The account's view of the Apple Health connection (`GET /v1/healthkit/connection`).
public struct HealthKitConnectionRecord: Codable, Equatable, Sendable {
    public struct History: Codable, Equatable, Sendable {
        /// "not_started", "importing", "complete" or "failed".
        public let status: String
        public let from: String?
        public let daysRequested: Int?
    }
    public struct LastError: Codable, Equatable, Sendable {
        public let code: String
        public let at: Date
    }
    /// "never_connected", "connected" or "disconnected".
    public let status: String
    public let deviceName: String?
    public let scopes: [String]
    public let lastSyncAt: Date?
    public var history: History? = nil
    public var lastError: LastError? = nil
}
