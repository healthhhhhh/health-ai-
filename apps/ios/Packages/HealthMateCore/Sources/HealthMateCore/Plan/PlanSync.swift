import Foundation

// MARK: - Wire format (services/api `/v1/plan`, packages/shared-types PlanRecord)

public struct PlanRecord: Codable, Equatable, Sendable {
    public var revision: Int
    public var items: [PlanItemWire]
    public var completions: [PlanCompletionWire]

    public init(revision: Int, items: [PlanItemWire], completions: [PlanCompletionWire]) {
        self.revision = revision
        self.items = items
        self.completions = completions
    }
}

public struct PlanItemWire: Codable, Equatable, Sendable {
    public struct Repeat: Codable, Equatable, Sendable {
        public var type: String
        public var days: [Int]?
        public var day: String?
    }

    public var id: String
    public var title: String
    public var notes: String?
    public var kind: String
    public var time: String
    public var `repeat`: Repeat
    public var reminderEnabled: Bool
    public var source: String
    public var instruction: String?
    public var startDay: String
    public var endDay: String?
    public var createdAt: Date
}

public struct PlanCompletionWire: Codable, Equatable, Sendable {
    public var itemId: String
    public var day: String
    public var completedAt: Date
}

extension PlanItemWire {
    /// Sample (demo) items never leave the device, so they have no wire form.
    public init?(_ item: PlanItem) {
        guard item.source == .userReported || item.source == .clinicianProvided else { return nil }
        id = item.id.uuidString.lowercased()
        title = item.title
        notes = item.notes
        kind = item.kind.rawValue
        time = item.time.hhmm
        switch item.repeatRule {
        case .daily: self.repeat = Repeat(type: "daily")
        case .weekdays(let days): self.repeat = Repeat(type: "weekdays", days: days.sorted())
        case .once(let day): self.repeat = Repeat(type: "once", day: day.rawValue)
        }
        reminderEnabled = item.reminderEnabled
        source = item.source.rawValue
        instruction = item.instruction
        startDay = item.startDay.rawValue
        endDay = item.endDay?.rawValue
        createdAt = item.createdAt
    }

    public var planItem: PlanItem? {
        guard let uuid = UUID(uuidString: id),
              let kind = PlanItemKind(rawValue: kind),
              let source = DataSource(rawValue: source),
              let start = DayKey(rawValue: startDay)
        else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        let rule: PlanRepeat
        switch self.repeat.type {
        case "weekdays": rule = .weekdays(Set(self.repeat.days ?? []))
        case "once":
            guard let day = self.repeat.day.flatMap(DayKey.init(rawValue:)) else { return nil }
            rule = .once(day)
        default: rule = .daily
        }
        return PlanItem(
            id: uuid, title: title, notes: notes, kind: kind, time: TimeOfDay(hour: parts[0], minute: parts[1]),
            repeatRule: rule, reminderEnabled: reminderEnabled, source: source, instruction: instruction,
            startDay: start, endDay: endDay.flatMap(DayKey.init(rawValue:)), createdAt: createdAt
        )
    }
}

extension PlanRecord {
    /// The synced part of a local document (sample items and their completions stay on the device).
    public init(document: PlanDocument, revision: Int) {
        let items = document.items.compactMap(PlanItemWire.init)
        let ids = Set(items.map(\.id))
        self.init(
            revision: revision,
            items: items,
            completions: document.completions
                .map { PlanCompletionWire(itemId: $0.itemId.uuidString.lowercased(), day: $0.day.rawValue, completedAt: $0.completedAt) }
                .filter { ids.contains($0.itemId) }
        )
    }

    public var document: PlanDocument {
        PlanDocument(
            items: items.compactMap(\.planItem),
            completions: completions.compactMap { c in
                guard let id = UUID(uuidString: c.itemId), let day = DayKey(rawValue: c.day) else { return nil }
                return PlanCompletion(itemId: id, day: day, completedAt: c.completedAt)
            }
        )
    }
}

// MARK: - Three-way merge

/// Merges plan changes made on this device with changes made elsewhere
/// (e.g. the web app), relative to the last version both had in common.
/// A change on one side wins over no change on the other; when both sides
/// changed the same item, this device's version wins. Deletions count as changes.
public enum PlanMerge {
    public static func merge(base: PlanDocument, local: PlanDocument, remote: PlanDocument) -> PlanDocument {
        let baseItems = Dictionary(base.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let localItems = Dictionary(local.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let remoteItems = Dictionary(remote.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        var items: [PlanItem] = []
        for id in Set(baseItems.keys).union(localItems.keys).union(remoteItems.keys) {
            if let chosen = pick(base: baseItems[id], local: localItems[id], remote: remoteItems[id]) { items.append(chosen) }
        }
        let order = Dictionary((local.items + remote.items).enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        items.sort { (order[$0.id] ?? .max) < (order[$1.id] ?? .max) }

        struct Key: Hashable { let item: UUID; let day: DayKey }
        let key = { (c: PlanCompletion) in Key(item: c.itemId, day: c.day) }
        let baseDone = Dictionary(base.completions.map { (key($0), $0) }, uniquingKeysWith: { a, _ in a })
        let localDone = Dictionary(local.completions.map { (key($0), $0) }, uniquingKeysWith: { a, _ in a })
        let remoteDone = Dictionary(remote.completions.map { (key($0), $0) }, uniquingKeysWith: { a, _ in a })
        let alive = Set(items.map(\.id))
        var completions: [PlanCompletion] = []
        for k in Set(baseDone.keys).union(localDone.keys).union(remoteDone.keys) where alive.contains(k.item) {
            if let chosen = pick(base: baseDone[k], local: localDone[k], remote: remoteDone[k]) { completions.append(chosen) }
        }
        completions.sort { ($0.day, $0.itemId.uuidString) < ($1.day, $1.itemId.uuidString) }
        return PlanDocument(version: local.version, items: items, completions: completions, seeded: local.seeded)
    }

    /// nil = absent (never existed or deleted).
    private static func pick<T: Equatable>(base: T?, local: T?, remote: T?) -> T? {
        if local == remote { return local }
        if local == base { return remote } // only remote changed
        if remote == base { return local } // only local changed
        return local ?? remote // both changed: this device wins; an edit beats a delete
    }
}

// MARK: - Syncing repository

/// Transport for the shared plan; `APIClient` provides it when signed in.
public protocol PlanSyncTransport: Sendable {
    /// nil when not signed in.
    func fetchPlan() async throws -> PlanRecord?
    /// Throws `PlanSyncError.conflict` when `baseRevision` is stale.
    func pushPlan(_ plan: PlanRecord) async throws -> PlanRecord
}

public enum PlanSyncError: Error, Equatable {
    case conflict
}

/// Keeps the plan on the device (it always works offline) and, when signed
/// in, shares it with the person's account so the web app sees the same plan.
public actor SyncingPlanRepository: PlanRepository {
    private let local: any PlanRepository
    private let transport: any PlanSyncTransport
    private let stateURL: URL?
    private var synced: (revision: Int, document: PlanDocument)?

    public init(local: any PlanRepository, transport: any PlanSyncTransport, stateURL: URL?) {
        self.local = local
        self.transport = transport
        self.stateURL = stateURL
    }

    public func load() async throws -> PlanDocument {
        let current = try await local.load()
        guard let merged = try? await sync(current) else { return current }
        if merged != current { try await local.save(merged) }
        return merged
    }

    public func save(_ document: PlanDocument) async throws {
        try await local.save(document)
        if let merged = try? await sync(document), merged != document {
            try await local.save(merged)
        }
    }

    /// Merges with the account copy and pushes the result. Returns the merged local document, or nil when not signed in.
    private func sync(_ current: PlanDocument) async throws -> PlanDocument? {
        let base = loadState()
        for _ in 0..<3 {
            guard let remote = try await transport.fetchPlan() else { return nil }
            let samples = current.items.filter { $0.source == .sample }
            let sampleIds = Set(samples.map(\.id))
            let shared = PlanRecord(document: current, revision: remote.revision).document
            let merged = PlanMerge.merge(base: base?.document ?? PlanDocument(), local: shared, remote: remote.document)
            let outgoing = PlanRecord(document: merged, revision: remote.revision)
            do {
                let stored = outgoing.items == remote.items && outgoing.completions == remote.completions ? remote : try await transport.pushPlan(outgoing)
                saveState(revision: stored.revision, document: stored.document)
                var result = stored.document
                result.items = samples + result.items
                result.completions = current.completions.filter { sampleIds.contains($0.itemId) } + result.completions
                result.seeded = current.seeded
                result.version = current.version
                return result
            } catch PlanSyncError.conflict {
                continue // changed elsewhere in the meantime: merge again
            }
        }
        throw PlanSyncError.conflict
    }

    private func loadState() -> (revision: Int, document: PlanDocument)? {
        if let synced { return synced }
        guard let stateURL, let data = try? Data(contentsOf: stateURL), let record = try? JSONCoding.makeDecoder().decode(PlanRecord.self, from: data) else { return nil }
        synced = (record.revision, record.document)
        return synced
    }

    private func saveState(revision: Int, document: PlanDocument) {
        synced = (revision, document)
        guard let stateURL, let data = try? JSONCoding.makeEncoder().encode(PlanRecord(document: document, revision: revision)) else { return }
        try? FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try? data.write(to: stateURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try? data.write(to: stateURL, options: [.atomic])
        #endif
    }
}
