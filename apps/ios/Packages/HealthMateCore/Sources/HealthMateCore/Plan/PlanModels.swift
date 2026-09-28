import Foundation

/// A calendar day independent of time zone, stored as "yyyy-MM-dd".
/// Lexicographic order equals chronological order.
public struct DayKey: Hashable, Codable, Comparable, Sendable, CustomStringConvertible {
    public let rawValue: String

    public init?(rawValue: String) {
        let parts = rawValue.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) else { return nil }
        self.rawValue = String(format: "%04d-%02d-%02d", parts[0], parts[1], parts[2])
    }

    public init(date: Date, calendar: Calendar) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        rawValue = String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Noon on this day in `calendar`'s time zone (noon avoids DST edge cases).
    public func date(in calendar: Calendar) -> Date? {
        let parts = rawValue.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    public func adding(days: Int, calendar: Calendar) -> DayKey {
        guard let date = date(in: calendar), let moved = calendar.date(byAdding: .day, value: days, to: date) else { return self }
        return DayKey(date: moved, calendar: calendar)
    }

    public static func < (lhs: DayKey, rhs: DayKey) -> Bool { lhs.rawValue < rhs.rawValue }
    public var description: String { rawValue }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let key = DayKey(rawValue: raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid day \(raw)"))
        }
        self = key
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }
}

public struct TimeOfDay: Hashable, Codable, Comparable, Sendable {
    public let hour: Int
    public let minute: Int

    public init(hour: Int, minute: Int) {
        self.hour = min(max(hour, 0), 23)
        self.minute = min(max(minute, 0), 59)
    }

    public init(date: Date, calendar: Calendar) {
        self.init(hour: calendar.component(.hour, from: date), minute: calendar.component(.minute, from: date))
    }

    /// "08:00"
    public var hhmm: String { String(format: "%02d:%02d", hour, minute) }

    public static func < (lhs: TimeOfDay, rhs: TimeOfDay) -> Bool {
        (lhs.hour, lhs.minute) < (rhs.hour, rhs.minute)
    }
}

public enum PlanItemKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case task, medication, habit
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .task: return "Tasks"
        case .medication: return "Medications"
        case .habit: return "Habits"
        }
    }

    public var singular: String {
        switch self {
        case .task: return "Task"
        case .medication: return "Medication"
        case .habit: return "Habit"
        }
    }
}

public enum PlanRepeat: Codable, Sendable, Equatable {
    case daily
    /// Calendar weekdays: 1 = Sunday … 7 = Saturday.
    case weekdays(Set<Int>)
    case once(DayKey)
}

/// Something the user wants to do and be reminded about.
///
/// Safety: for medications, `instruction` is the clinician's (or label's)
/// wording exactly as the user entered it. HealthMate never generates,
/// suggests or changes an instruction or dose.
public struct PlanItem: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public var title: String
    public var notes: String?
    public var kind: PlanItemKind
    public var time: TimeOfDay
    public var repeatRule: PlanRepeat
    public var reminderEnabled: Bool
    /// `.clinicianProvided`, `.userReported` or `.sample` (demo data).
    public var source: DataSource
    public var instruction: String?
    public var startDay: DayKey
    public var endDay: DayKey?
    public let createdAt: Date

    public init(id: UUID = UUID(), title: String, notes: String? = nil, kind: PlanItemKind, time: TimeOfDay, repeatRule: PlanRepeat, reminderEnabled: Bool, source: DataSource, instruction: String? = nil, startDay: DayKey, endDay: DayKey? = nil, createdAt: Date) {
        self.id = id
        self.title = title
        self.notes = notes
        self.kind = kind
        self.time = time
        self.repeatRule = repeatRule
        self.reminderEnabled = reminderEnabled
        self.source = source
        self.instruction = instruction
        self.startDay = startDay
        self.endDay = endDay
        self.createdAt = createdAt
    }
}

/// A completion record, kept separate from the item (and its instruction).
public struct PlanCompletion: Codable, Hashable, Sendable {
    public let itemId: UUID
    public let day: DayKey
    public let completedAt: Date

    public init(itemId: UUID, day: DayKey, completedAt: Date) {
        self.itemId = itemId
        self.day = day
        self.completedAt = completedAt
    }
}

/// One item on one day.
public struct PlanOccurrence: Identifiable, Equatable, Sendable {
    public let item: PlanItem
    public let day: DayKey
    public let completed: Bool
    public var id: String { "\(item.id.uuidString)|\(day.rawValue)" }
}

/// Everything persisted for the plan feature.
public struct PlanDocument: Codable, Equatable, Sendable {
    public static let currentVersion = 1

    public var version: Int
    public var items: [PlanItem]
    public var completions: [PlanCompletion]
    /// True once sample content has been offered, so deleting it doesn't bring it back.
    public var seeded: Bool

    public init(version: Int = PlanDocument.currentVersion, items: [PlanItem] = [], completions: [PlanCompletion] = [], seeded: Bool = false) {
        self.version = version
        self.items = items
        self.completions = completions
        self.seeded = seeded
    }
}
