import Foundation

// Mirrors packages/shared-types/src/index.ts — the API contract shared with the
// web app and backend. Keep the two in sync (or generate both from OpenAPI).

/// Where a piece of health information came from. Every health fact the UI
/// shows carries its provenance.
public enum DataSource: String, Codable, Sendable, CaseIterable {
    case userReported = "user_reported"
    case documentExtracted = "document_extracted"
    case wearable
    case appleHealth = "apple_health"
    case clinicianProvided = "clinician_provided"
    case aiInferred = "ai_inferred"
    case userConfirmed = "user_confirmed"
    /// Demo/mock data — never presented as the user's real data without a label.
    case sample
}

public struct UserProfile: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var firstName: String
    public var lastName: String
    public var avatarUrl: URL?
    /// IANA time zone identifier.
    public var timeZone: String

    public init(id: String, firstName: String, lastName: String, avatarUrl: URL? = nil, timeZone: String) {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.avatarUrl = avatarUrl
        self.timeZone = timeZone
    }

    public var fullName: String { "\(firstName) \(lastName)" }
}

public enum MetricKind: String, Codable, Sendable, CaseIterable {
    case heartRate = "heart_rate"
    case steps
    case sleep
    case calories
    case water
    case weight
    case bloodPressure = "blood_pressure"
}

/// Comparison with the user's own recent baseline — context, not a clinical judgement.
public enum MetricTrend: String, Codable, Sendable {
    case inUsualRange = "in_usual_range"
    case aboveUsual = "above_usual"
    case belowUsual = "below_usual"
    case noBaseline = "no_baseline"
}

public struct HealthMetric: Codable, Sendable, Equatable, Identifiable {
    public var kind: MetricKind
    /// Value in the canonical unit (bpm, steps, minutes, kcal, glasses, kg).
    public var value: Double
    public var unit: String
    public var recordedAt: Date
    public var source: DataSource
    public var trend: MetricTrend
    /// A daily goal the user set themselves.
    public var goal: Double?

    public var id: MetricKind { kind }

    public init(kind: MetricKind, value: Double, unit: String, recordedAt: Date, source: DataSource, trend: MetricTrend, goal: Double? = nil) {
        self.kind = kind
        self.value = value
        self.unit = unit
        self.recordedAt = recordedAt
        self.source = source
        self.trend = trend
        self.goal = goal
    }
}

public enum Mood: String, Codable, Sendable, CaseIterable, Identifiable {
    case great, good, okay, low, unwell
    public var id: String { rawValue }
}

public struct MoodCheckIn: Codable, Sendable, Equatable {
    public var mood: Mood
    public var recordedAt: Date

    public init(mood: Mood, recordedAt: Date) {
        self.mood = mood
        self.recordedAt = recordedAt
    }
}

public enum TaskCategory: String, Codable, Sendable {
    case medication, hydration, measurement, activity, supplement, sleep, other
}

public struct PlanTask: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var title: String
    public var detail: String?
    public var category: TaskCategory
    /// Local time of day, "HH:mm".
    public var scheduledTime: String
    public var completed: Bool
    /// Who authored the underlying instruction. The app never invents medical
    /// instructions: medication tasks come from a clinician or the user.
    public var source: DataSource

    public init(id: String, title: String, detail: String? = nil, category: TaskCategory, scheduledTime: String, completed: Bool, source: DataSource) {
        self.id = id
        self.title = title
        self.detail = detail
        self.category = category
        self.scheduledTime = scheduledTime
        self.completed = completed
        self.source = source
    }
}

public enum ActivityKind: String, Codable, Sendable {
    case report, image, medication, chat, sync, symptom, measurement, note, appointment
}

public struct ActivityEvent: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var kind: ActivityKind
    public var title: String
    public var occurredAt: Date
    public var source: DataSource
    /// In-app destination as a web path (see `AppRoute`).
    public var link: String?

    public init(id: String, kind: ActivityKind, title: String, occurredAt: Date, source: DataSource, link: String? = nil) {
        self.id = id
        self.kind = kind
        self.title = title
        self.occurredAt = occurredAt
        self.source = source
        self.link = link
    }
}

public struct Appointment: Codable, Sendable, Equatable, Identifiable {
    public enum Mode: String, Codable, Sendable { case inPerson = "in_person", video, phone }

    public let id: String
    public var title: String
    public var clinicianName: String
    public var specialty: String
    public var startsAt: Date
    public var mode: Mode
    /// From Care (has a detail screen), rather than a timeline entry.
    public var isCareAppointment: Bool

    public init(id: String, title: String, clinicianName: String, specialty: String, startsAt: Date, mode: Mode, isCareAppointment: Bool = false) {
        self.id = id
        self.title = title
        self.clinicianName = clinicianName
        self.specialty = specialty
        self.startsAt = startsAt
        self.mode = mode
        self.isCareAppointment = isCareAppointment
    }

    enum CodingKeys: String, CodingKey { case id, title, clinicianName, specialty, startsAt, mode }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            title: try c.decode(String.self, forKey: .title),
            clinicianName: try c.decode(String.self, forKey: .clinicianName),
            specialty: try c.decode(String.self, forKey: .specialty),
            startsAt: try c.decode(Date.self, forKey: .startsAt),
            mode: try c.decode(Mode.self, forKey: .mode)
        )
    }
}

/// An AI-generated observation. Always shown labelled as AI-generated, with its basis.
public struct AIInsight: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var message: String
    public var basedOn: String
    public var generatedAt: Date
    public var source: DataSource

    public init(id: String, message: String, basedOn: String, generatedAt: Date, source: DataSource) {
        self.id = id
        self.message = message
        self.basedOn = basedOn
        self.generatedAt = generatedAt
        self.source = source
    }
}

public struct HomeSummary: Codable, Sendable, Equatable {
    public var user: UserProfile
    public var metrics: [HealthMetric]
    public var todayMood: MoodCheckIn?
    public var tasks: [PlanTask]
    public var recentActivity: [ActivityEvent]
    public var upcomingAppointments: [Appointment]
    public var insight: AIInsight?
    public var unreadNotifications: Int

    public init(user: UserProfile, metrics: [HealthMetric], todayMood: MoodCheckIn?, tasks: [PlanTask], recentActivity: [ActivityEvent], upcomingAppointments: [Appointment], insight: AIInsight?, unreadNotifications: Int) {
        self.user = user
        self.metrics = metrics
        self.todayMood = todayMood
        self.tasks = tasks
        self.recentActivity = recentActivity
        self.upcomingAppointments = upcomingAppointments
        self.insight = insight
        self.unreadNotifications = unreadNotifications
    }
}
