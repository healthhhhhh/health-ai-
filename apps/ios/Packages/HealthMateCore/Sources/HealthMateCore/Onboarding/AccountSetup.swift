import Foundation

/// What the person wants help with. Same ids as the web (`HEALTH_GOALS` in apps/web/src/lib/onboarding.ts).
public struct HealthGoal: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let description: String
    public let systemImage: String

    public static let all: [HealthGoal] = [
        HealthGoal(id: "understand_reports", label: "Understand my reports", description: "Plain-language summaries of test results and letters", systemImage: "doc.text.magnifyingglass"),
        HealthGoal(id: "track_symptoms", label: "Keep track of symptoms", description: "Notice patterns and share them with my clinician", systemImage: "waveform.path.ecg"),
        HealthGoal(id: "manage_medications", label: "Stay on top of medications", description: "Reminders with instructions exactly as prescribed", systemImage: "pills"),
        HealthGoal(id: "sleep_better", label: "Sleep better", description: "Build a steady routine", systemImage: "moon.zzz"),
        HealthGoal(id: "be_active", label: "Be more active", description: "Small, steady steps", systemImage: "figure.walk"),
        HealthGoal(id: "prepare_appointments", label: "Prepare for appointments", description: "Questions and notes ready to go", systemImage: "calendar.badge.clock"),
    ]
}

/// First-run account setup, in order. Only "About you" needs anything (a first name).
public enum AccountSetupStep: Int, CaseIterable, Sendable {
    case about, goals, health, privacy, reminders, appleHealth, done

    public var title: String {
        switch self {
        case .about: "About you"
        case .goals: "What would help most?"
        case .health: "Your health details"
        case .privacy: "Your privacy choices"
        case .reminders: "Reminders"
        case .appleHealth: "Apple Health"
        case .done: "You're all set"
        }
    }

    public var isOptional: Bool { self == .health || self == .appleHealth }

    /// Steps before the summary, for "Step 2 of 6".
    public static var countedSteps: Int { allCases.count - 1 }

    public var next: AccountSetupStep? { AccountSetupStep(rawValue: rawValue + 1) }
    public var previous: AccountSetupStep? { AccountSetupStep(rawValue: rawValue - 1) }
}

/// Everything chosen during setup. Nothing is saved until `save(using:)`.
public struct AccountSetupDraft: Equatable, Sendable {
    public struct Medication: Equatable, Sendable, Identifiable {
        public let id = UUID()
        public var name: String
        /// Exactly as written on the prescription or label.
        public var instruction: String
        public init(name: String, instruction: String) {
            self.name = name
            self.instruction = instruction
        }
    }

    public static let consentKinds = ["ai_processing", "document_processing", "health_data_sync", "voice"]
    public static let sexOptions: [(value: String, label: String)] = [("female", "Female"), ("male", "Male"), ("intersex", "Intersex"), ("prefer_not_to_say", "Prefer not to say")]

    public var firstName: String
    public var lastName: String
    public var dateOfBirth: Date?
    public var sex: String?
    public var goals: Set<String>
    public var conditions: [String] = []
    public var allergies: [String] = []
    public var medications: [Medication] = []
    public var consents: [String: Bool]
    public var reminders = NotificationPreferences()

    public init(profile: ProfileDetails? = nil, consents: [String: Bool] = [:]) {
        firstName = profile?.firstName ?? ""
        lastName = profile?.lastName ?? ""
        dateOfBirth = profile?.dateOfBirth.flatMap(Self.dayFormatter.date(from:))
        sex = profile?.sex
        goals = Set(profile?.goals ?? [])
        self.consents = Dictionary(uniqueKeysWithValues: Self.consentKinds.map { ($0, consents[$0] == true) })
    }

    /// The message to show before leaving `step`, or nil when it can continue.
    public func problem(at step: AccountSetupStep, now: Date = Date()) -> String? {
        switch step {
        case .about:
            if firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter your first name." }
            if let dateOfBirth, dateOfBirth > now { return "Your date of birth can't be in the future." }
            return nil
        case .health:
            if medications.contains(where: { $0.name.trimmed.isEmpty || $0.instruction.trimmed.isEmpty }) {
                return "Each medication needs a name and its instructions exactly as written."
            }
            return nil
        default:
            return nil
        }
    }

    public var grantedConsentCount: Int { Self.consentKinds.filter { consents[$0] == true }.count }

    /// Saves the profile, health details (as "you added", never clinician-confirmed), consents and reminders, then marks setup done.
    public func save(using api: APIClient, timeZone: String = TimeZone.current.identifier) async throws {
        let details = ProfileDetails(
            firstName: String(firstName.trimmed.prefix(80)),
            lastName: String(lastName.trimmed.prefix(80)),
            dateOfBirth: dateOfBirth.map(Self.dayFormatter.string(from:)),
            sex: sex,
            heightCm: nil,
            timeZone: timeZone,
            goals: HealthGoal.all.map(\.id).filter(goals.contains)
        )
        _ = try await api.updateProfile(details)
        for name in conditions.map(\.trimmed) where !name.isEmpty {
            try await api.addCondition(name: String(name.prefix(120)), source: .userReported)
        }
        for substance in allergies.map(\.trimmed) where !substance.isEmpty {
            try await api.addAllergy(substance: String(substance.prefix(120)), reaction: nil, source: .userReported)
        }
        for medication in medications {
            // Only surrounding whitespace is removed; the wording is kept exactly.
            try await api.addMedication(name: String(medication.name.trimmed.prefix(120)), instruction: String(medication.instruction.trimmed.prefix(500)), source: .userReported)
        }
        for kind in Self.consentKinds {
            try await api.setConsent(kind, granted: consents[kind] == true)
        }
        try await Self.optional {
            var current = try await api.notificationPreferences()
            current.medication = reminders.medication
            current.task = reminders.task
            current.appointment = reminders.appointment
            current.showDetails = reminders.showDetails
            try await api.updateNotificationPreferences(current)
        }
        try await Self.optional { try await api.completeOnboarding() }
    }

    /// Endpoints the Phase 1 UI uses that an older API server may not have yet.
    private static func optional(_ work: () async throws -> Void) async throws {
        do {
            try await work()
        } catch APIError.server(let status, _, _) where status == 404 || status == 501 {
            return
        }
    }

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
