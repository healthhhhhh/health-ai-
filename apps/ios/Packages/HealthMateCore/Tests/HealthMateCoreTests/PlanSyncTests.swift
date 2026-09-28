import XCTest
@testable import HealthMateCore

final class PlanSyncTests: XCTestCase {
    private let day = DayKey(rawValue: "2026-09-28")!
    private let created = Date(timeIntervalSince1970: 1_790_000_000)

    private func item(_ title: String, kind: PlanItemKind = .habit, source: DataSource = .userReported, instruction: String? = nil) -> PlanItem {
        PlanItem(title: title, kind: kind, time: TimeOfDay(hour: 8, minute: 0), repeatRule: .weekdays([2, 4]), reminderEnabled: true, source: source, instruction: instruction, startDay: day, createdAt: created)
    }

    func testWireRoundTripKeepsInstructionsVerbatimAndDropsSamples() {
        let med = item("Metformin", kind: .medication, source: .clinicianProvided, instruction: "  1 tablet (500 mg) after breakfast — per Dr. Rao ")
        let sample = item("Sample walk", source: .sample)
        let doc = PlanDocument(items: [med, sample], completions: [PlanCompletion(itemId: med.id, day: day, completedAt: created), PlanCompletion(itemId: sample.id, day: day, completedAt: created)])
        let record = PlanRecord(document: doc, revision: 3)
        XCTAssertEqual(record.items.count, 1)
        XCTAssertEqual(record.items.first?.id, med.id.uuidString.lowercased())
        XCTAssertEqual(record.completions.count, 1)
        let back = record.document
        XCTAssertEqual(back.items, [med])
        XCTAssertEqual(back.items.first?.instruction, "  1 tablet (500 mg) after breakfast — per Dr. Rao ")
    }

    func testMergeKeepsChangesFromBothSides() {
        let walk = item("Walk"), water = item("Water"), stretch = item("Stretch")
        let base = PlanDocument(items: [walk, water])
        var local = base
        local.items.append(stretch) // added on the phone
        var remote = base
        remote.items.removeAll { $0.id == water.id } // deleted on the web
        remote.completions = [PlanCompletion(itemId: walk.id, day: day, completedAt: created)] // ticked on the web

        let merged = PlanMerge.merge(base: base, local: local, remote: remote)
        XCTAssertEqual(Set(merged.items.map(\.title)), ["Walk", "Stretch"])
        XCTAssertEqual(merged.completions.count, 1)
    }

    func testBothChangedThisDeviceWinsAndEditBeatsDelete() {
        let walk = item("Walk")
        let base = PlanDocument(items: [walk])
        var local = base
        local.items[0].title = "Long walk"
        var remote = base
        remote.items[0].title = "Short walk"
        XCTAssertEqual(PlanMerge.merge(base: base, local: local, remote: remote).items.first?.title, "Long walk")

        let deletedRemotely = PlanDocument()
        XCTAssertEqual(PlanMerge.merge(base: base, local: local, remote: deletedRemotely).items.first?.title, "Long walk")
    }

    func testCompletionsOfDeletedItemsAreDropped() {
        let walk = item("Walk")
        let base = PlanDocument(items: [walk])
        var local = base
        local.completions = [PlanCompletion(itemId: walk.id, day: day, completedAt: created)]
        let remote = PlanDocument() // deleted on the web, untouched locally
        let merged = PlanMerge.merge(base: base, local: local, remote: remote)
        XCTAssertTrue(merged.items.isEmpty)
        XCTAssertTrue(merged.completions.isEmpty)
    }

    func testSyncingRepositoryRetriesOnConflictAndKeepsSamplesLocal() async throws {
        let sample = item("Sample", source: .sample)
        let mine = item("Mine")
        let local = InMemoryPlanRepository(document: PlanDocument(items: [sample, mine], seeded: true))
        let remoteItem = item("From web")
        let transport = FakeTransport(record: PlanRecord(document: PlanDocument(items: [remoteItem]), revision: 4), conflictsFirst: true)
        let repo = SyncingPlanRepository(local: local, transport: transport, stateURL: nil)

        let loaded = try await repo.load()
        XCTAssertEqual(Set(loaded.items.map(\.title)), ["Sample", "Mine", "From web"])
        XCTAssertTrue(loaded.seeded)
        let pushed = await transport.record
        XCTAssertEqual(Set(pushed.items.map(\.title)), ["Mine", "From web"], "Sample items never leave the device")
        XCTAssertEqual(pushed.revision, 5)
    }

    func testSignedOutStaysLocal() async throws {
        let local = InMemoryPlanRepository(document: PlanDocument(items: [item("Mine")]))
        let repo = SyncingPlanRepository(local: local, transport: FakeTransport(record: nil, conflictsFirst: false), stateURL: nil)
        let loaded = try await repo.load()
        XCTAssertEqual(loaded.items.map(\.title), ["Mine"])
    }
}

private actor FakeTransport: PlanSyncTransport {
    var stored: PlanRecord?
    var conflicts: Bool
    init(record: PlanRecord?, conflictsFirst: Bool) {
        stored = record
        conflicts = conflictsFirst
    }
    var record: PlanRecord { stored! }

    func fetchPlan() async throws -> PlanRecord? { stored }

    func pushPlan(_ plan: PlanRecord) async throws -> PlanRecord {
        guard let current = stored else { throw PlanSyncError.conflict }
        if conflicts {
            conflicts = false
            throw PlanSyncError.conflict
        }
        guard plan.revision == current.revision else { throw PlanSyncError.conflict }
        stored = PlanRecord(revision: current.revision + 1, items: plan.items, completions: plan.completions)
        return stored!
    }
}
