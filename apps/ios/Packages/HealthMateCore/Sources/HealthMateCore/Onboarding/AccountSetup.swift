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

/// First-run account setup, in order: welcome, Apple Health (optional), name and
/// date of birth (checked by the server), privacy choices, the Apple Health import
/// (only when Apple Health was connected) and a summary.
public enum AccountSetupStep: Int, CaseIterable, Sendable {
    case welcome, appleHealth, about, privacy, importHealth, done

    public var title: String {
        switch self {
        case .welcome: "Welcome to HealthMate"
        case .appleHealth: "Connect Apple Health"
        case .about: "About you"
        case .privacy: "Your privacy choices"
        case .importHealth: "Importing your health data"
        case .done: "You're all set"
        }
    }

    public var isOptional: Bool { self == .appleHealth || self == .importHealth }

    /// Steps between the welcome screen and the summary, for "Step 2 of 4".
    public static var countedSteps: Int { allCases.count - 2 }
    /// This step's number in "Step n of 4" (the welcome screen isn't counted).
    public var number: Int { rawValue }

    /// The step after this one. The import is shown only when Apple Health was connected
    /// and the person kept Apple Health sync on.
    public func next(importsHealth: Bool) -> AccountSetupStep? {
        switch self {
        case .privacy:
            return importsHealth ? .importHealth : .done
        case .done:
            return nil
        default:
            return AccountSetupStep(rawValue: rawValue + 1)
        }
    }

    /// Going back stops at the privacy choices: the profile is already saved by then.
    public var previous: AccountSetupStep? {
        switch self {
        case .welcome, .importHealth, .done:
            return nil
        default:
            return AccountSetupStep(rawValue: rawValue - 1)
        }
    }
}

/// Where the date of birth in the form came from.
public enum DateOfBirthSource: Equatable, Sendable {
    /// Typed or picked by the person, or already in their profile.
    case person
    /// Read from Apple Health with permission. The person must confirm it before it's sent.
    case appleHealth
}

/// Everything chosen during setup. The date of birth is checked by the server first
/// (`confirmAge`); the profile and privacy choices are saved after that (`save`).
public struct AccountSetupDraft: Equatable, Sendable {
    public static let consentKinds = ["ai_processing", "document_processing", "health_data_sync", "voice"]
    public static let sexOptions: [(value: String, label: String)] = [("female", "Female"), ("male", "Male"), ("intersex", "Intersex"), ("prefer_not_to_say", "Prefer not to say")]

    public var firstName: String
    public var lastName: String
    public private(set) var dateOfBirth: Date?
    public private(set) var dateOfBirthSource: DateOfBirthSource = .person
    /// The person said a date of birth read from Apple Health is right.
    public var dateOfBirthConfirmed = false
    public var sex: String?
    /// Kept as they are (goals are chosen later in Profile).
    public var goals: [String]
    public var consents: [String: Bool]

    /// Prefills from the account (the name given at sign-up, readable before the age check)
    /// and, when it's already readable, the health profile.
    public init(account: AccountSummary? = nil, profile: ProfileDetails? = nil, consents: [String: Bool] = [:]) {
        firstName = account?.firstName ?? profile?.firstName ?? ""
        lastName = account?.lastName ?? profile?.lastName ?? ""
        dateOfBirth = profile?.dateOfBirth.flatMap(Self.dayFormatter.date(from:))
        sex = profile?.sex
        goals = profile?.goals ?? []
        self.consents = Dictionary(uniqueKeysWithValues: Self.consentKinds.map { ($0, consents[$0] == true) })
    }

    /// The person entered or changed the date themselves.
    public mutating func setDateOfBirth(_ date: Date?) {
        dateOfBirth = date
        dateOfBirthSource = .person
        dateOfBirthConfirmed = false
    }

    /// A date of birth Apple Health shared. Used only to prefill an empty field; it isn't
    /// proof of age and is sent to the server only after the person confirms it.
    public mutating func prefillDateOfBirth(fromAppleHealth components: DateComponents?) {
        guard dateOfBirth == nil, let components, let year = components.year, let month = components.month, let day = components.day else { return }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return }
        dateOfBirth = date
        dateOfBirthSource = .appleHealth
        dateOfBirthConfirmed = false
    }

    /// The message to show before leaving `step`, or nil when it can continue.
    public func problem(at step: AccountSetupStep, now: Date = Date()) -> String? {
        guard step == .about else { return nil }
        if firstName.trimmed.isEmpty { return "Enter your first name." }
        guard let dateOfBirth else { return "Enter your date of birth." }
        if dateOfBirth > now { return "Your date of birth can't be in the future." }
        if dateOfBirthSource == .appleHealth, !dateOfBirthConfirmed { return "Check that the date of birth from Apple Health is right, then confirm it." }
        return nil
    }

    public var grantedConsentCount: Int { Self.consentKinds.filter { consents[$0] == true }.count }

    /// `YYYY-MM-DD`, as the API expects.
    public var dateOfBirthDay: String? { dateOfBirth.map(Self.dayFormatter.string(from:)) }

    /// Sends the confirmed date of birth to the server, which alone decides whether the
    /// person can use HealthMate. Nothing else has been saved at this point.
    public func confirmAge(using api: APIClient) async throws -> AgeEligibility {
        guard let day = dateOfBirthDay else { return .ageRequired }
        do {
            return try await api.assessAge(dateOfBirth: day).eligibility ?? .eligible
        } catch APIError.server(let status, _, _) where status == 404 || status == 501 {
            // Servers without age assessment (older, or turned off) don't restrict anyone by age.
            return .eligible
        }
    }

    /// Saves the profile and privacy choices (after the age check passed).
    public func save(using api: APIClient, timeZone: String = TimeZone.current.identifier) async throws {
        let details = ProfileDetails(
            firstName: String(firstName.trimmed.prefix(80)),
            lastName: String(lastName.trimmed.prefix(80)),
            dateOfBirth: dateOfBirthDay,
            sex: sex,
            heightCm: nil,
            timeZone: timeZone,
            goals: goals
        )
        _ = try await api.updateProfile(details)
        for kind in Self.consentKinds {
            try await api.setConsent(kind, granted: consents[kind] == true)
        }
    }

    /// Marks setup as done (an older server without the endpoint counts as done).
    public static func finish(using api: APIClient) async throws {
        do {
            try await api.completeOnboarding()
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
