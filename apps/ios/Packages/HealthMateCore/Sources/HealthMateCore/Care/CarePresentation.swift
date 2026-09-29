import Foundation

/// Fields for adding or editing an appointment. Empty optionals are sent as null so edits can clear them.
public struct AppointmentDraft: Encodable, Equatable, Sendable {
    public var title: String
    public var careProviderId: String?
    public var startsAt: Date
    public var endsAt: Date?
    public var mode: AppointmentRecord.Mode?
    public var location: String?
    public var notes: String?

    public init(title: String, careProviderId: String?, startsAt: Date, endsAt: Date?, mode: AppointmentRecord.Mode?, location: String?, notes: String?) {
        self.title = title
        self.careProviderId = careProviderId
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.mode = mode
        self.location = location
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey { case title, careProviderId, startsAt, endsAt, mode, location, notes }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(careProviderId, forKey: .careProviderId)
        try c.encode(startsAt, forKey: .startsAt)
        try c.encode(endsAt, forKey: .endsAt)
        try c.encode(mode, forKey: .mode)
        try c.encode(location, forKey: .location)
        try c.encode(notes, forKey: .notes)
    }

    /// Checks before saving; nil when fine.
    public var problem: String? {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Give the appointment a name." : nil
    }
}

/// Fields for adding or editing a care team member.
public struct CareProviderDraft: Encodable, Equatable, Sendable {
    public var name: String
    public var specialty: String?
    public var phone: String?
    public var address: String?
    public var website: String?
    public var notes: String?

    public init(name: String, specialty: String?, phone: String?, address: String?, website: String?, notes: String?) {
        self.name = name
        self.specialty = specialty
        self.phone = phone
        self.address = address
        self.website = website
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey { case name, specialty, phone, address, website, notes }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(specialty, forKey: .specialty)
        try c.encode(phone, forKey: .phone)
        try c.encode(address, forKey: .address)
        try c.encode(website, forKey: .website)
        try c.encode(notes, forKey: .notes)
    }

    /// Same checks as the web form; nil when fine.
    public var problem: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Add a name." }
        if let website, !website.isEmpty, website.range(of: #"^https?://\S+\.\S+"#, options: .regularExpression) == nil {
            return "Enter the website as a full address, starting with https://"
        }
        return nil
    }
}

extension AppointmentRecord.Mode: CaseIterable, Identifiable {
    public static var allCases: [AppointmentRecord.Mode] { [.inPerson, .video, .phone] }
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .inPerson: "In person"
        case .video: "Video call"
        case .phone: "Phone call"
        }
    }
}

/// Upcoming vs past appointments. Mirrors `splitAppointments` in apps/web/src/lib/care.ts.
public enum AppointmentList {
    public static func split(_ list: [AppointmentRecord], now: Date = Date()) -> (upcoming: [AppointmentRecord], past: [AppointmentRecord]) {
        let upcoming = list.filter { $0.status == .scheduled && $0.startsAt >= now }.sorted { $0.startsAt < $1.startsAt }
        let ids = Set(upcoming.map(\.id))
        let past = list.filter { !ids.contains($0.id) }.sorted { $0.startsAt > $1.startsAt }
        return (upcoming, past)
    }
}

/// A "Questions to ask:" checklist kept inside the appointment notes. Same format as the web.
public struct PrepQuestion: Equatable, Hashable, Sendable {
    public var text: String
    public var done: Bool
    public init(text: String, done: Bool) {
        self.text = text
        self.done = done
    }
}

public enum AppointmentPrep {
    public static let heading = "Questions to ask:"
    public static let suggestions = [
        "What should I expect from this visit?",
        "Are there any results I should know about?",
        "Is there anything I should do differently before my next visit?",
        "Who should I contact if something changes?",
    ]

    public static func parse(_ notes: String?) -> (notes: String, questions: [PrepQuestion]) {
        let text = notes ?? ""
        guard let range = text.range(of: heading) else { return (text.trimmingCharacters(in: .whitespacesAndNewlines), []) }
        var questions: [PrepQuestion] = []
        var rest: [String] = []
        for line in text[range.upperBound...].components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- [ ] ") || trimmed.lowercased().hasPrefix("- [x] ") {
                let question = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                if !question.isEmpty { questions.append(PrepQuestion(text: question, done: !trimmed.hasPrefix("- [ ] "))) }
            } else if !trimmed.isEmpty {
                rest.append(line)
            }
        }
        let before = String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (([before] + rest).filter { !$0.isEmpty }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), questions)
    }

    public static func serialize(notes: String, questions: [PrepQuestion]) -> String? {
        let block = questions.isEmpty ? "" : ([heading] + questions.map { "- [\($0.done ? "x" : " ")] \($0.text.split(whereSeparator: \.isWhitespace).joined(separator: " "))" }).joined(separator: "\n")
        let out = [notes.trimmingCharacters(in: .whitespacesAndNewlines), block].filter { !$0.isEmpty }.joined(separator: "\n\n")
        return out.isEmpty ? nil : out
    }
}
