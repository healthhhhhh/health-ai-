import Foundation

/// Editable form state for creating or editing a plan item, with validation.
public struct PlanItemDraft: Equatable, Sendable {
    public enum RepeatKind: String, CaseIterable, Sendable, Identifiable {
        case daily, weekdays, once
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .daily: return "Every day"
            case .weekdays: return "Selected days"
            case .once: return "Once"
            }
        }
    }

    /// Who gave a medication instruction. The app itself never is one of them.
    public enum InstructionSource: String, CaseIterable, Sendable, Identifiable {
        case clinician, userOrLabel
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .clinician: return "My clinician"
            case .userOrLabel: return "Me / the label"
            }
        }
        var dataSource: DataSource { self == .clinician ? .clinicianProvided : .userReported }
    }

    public struct Errors: Equatable, Sendable {
        public var title: String?
        public var instruction: String?
        public var weekdays: String?
        public var isEmpty: Bool { title == nil && instruction == nil && weekdays == nil }
        public init() {}
    }

    public static let maxTitleLength = 80

    public var kind: PlanItemKind
    public var title: String
    public var notes: String
    public var instruction: String
    public var instructionSource: InstructionSource
    public var time: TimeOfDay
    public var repeatKind: RepeatKind
    public var weekdays: Set<Int>
    public var onceDay: DayKey
    public var reminderEnabled: Bool

    public init(kind: PlanItemKind, today: DayKey, time: TimeOfDay = TimeOfDay(hour: 9, minute: 0)) {
        self.kind = kind
        title = ""
        notes = ""
        instruction = ""
        instructionSource = .clinician
        self.time = time
        repeatKind = .daily
        weekdays = []
        onceDay = today
        reminderEnabled = true
    }

    public init(editing item: PlanItem, today: DayKey) {
        kind = item.kind
        title = item.title
        notes = item.notes ?? ""
        instruction = item.instruction ?? ""
        instructionSource = item.source == .clinicianProvided ? .clinician : .userOrLabel
        time = item.time
        reminderEnabled = item.reminderEnabled
        weekdays = []
        onceDay = today
        switch item.repeatRule {
        case .daily: repeatKind = .daily
        case .weekdays(let days): repeatKind = .weekdays; weekdays = days
        case .once(let day): repeatKind = .once; onceDay = day
        }
    }

    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    public func validate() -> Errors {
        var errors = Errors()
        let name = trimmed(title)
        if name.isEmpty {
            errors.title = kind == .medication ? "Enter the medication name." : "Give this a name."
        } else if name.count > Self.maxTitleLength {
            errors.title = "Keep the name under \(Self.maxTitleLength) characters."
        }
        if kind == .medication, trimmed(instruction).isEmpty {
            errors.instruction = "Enter the instructions exactly as your clinician or the label gives them."
        }
        if repeatKind == .weekdays, weekdays.isEmpty {
            errors.weekdays = "Pick at least one day."
        }
        return errors
    }

    /// Builds the item. Returns nil when invalid. Editing keeps id, creation date and start day.
    public func makeItem(existing: PlanItem?, today: DayKey, now: Date) -> PlanItem? {
        guard validate().isEmpty else { return nil }
        let rule: PlanRepeat
        switch repeatKind {
        case .daily: rule = .daily
        case .weekdays: rule = .weekdays(weekdays)
        case .once: rule = .once(onceDay)
        }
        let isMedication = kind == .medication
        let note = trimmed(notes)
        let source: DataSource
        if isMedication {
            source = instructionSource.dataSource
        } else if let existing, existing.source == .sample {
            source = .userReported // edited by the user, so no longer sample content
        } else {
            source = existing?.source ?? .userReported
        }
        return PlanItem(
            id: existing?.id ?? UUID(),
            title: trimmed(title),
            notes: isMedication || note.isEmpty ? nil : note,
            kind: kind,
            time: time,
            repeatRule: rule,
            reminderEnabled: reminderEnabled,
            source: source,
            instruction: isMedication ? trimmed(instruction) : nil,
            startDay: existing?.startDay ?? min(today, rule.firstDay ?? today),
            endDay: existing?.endDay,
            createdAt: existing?.createdAt ?? now
        )
    }
}

extension PlanRepeat {
    var firstDay: DayKey? {
        if case .once(let day) = self { return day }
        return nil
    }
}
