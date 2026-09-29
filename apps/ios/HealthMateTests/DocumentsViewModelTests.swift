import HealthMateCore
import XCTest
@testable import HealthMate

@MainActor
final class DocumentsViewModelTests: XCTestCase {
    nonisolated(unsafe) private static var offline = false

    override func tearDown() {
        Self.offline = false
        PreviewURLProtocol.state = { .normal }
        super.tearDown()
    }

    private func makeModel() async throws -> DocumentsViewModel {
        PreviewURLProtocol.backend = PreviewBackend()
        PreviewURLProtocol.state = { DocumentsViewModelTests.offline ? .offline : .normal }
        let api = APIClient(baseURL: PreviewURLProtocol.baseURL, tokens: InMemoryTokenStore(), session: PreviewURLProtocol.makeSession())
        _ = try await api.login(email: "alex.morgan@example.com", password: "preview-password")
        return DocumentsViewModel(api: api, isPreview: true)
    }

    func testFiltersAndSearchNarrowTheList() async throws {
        let model = try await makeModel()
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.shown.count, model.documents.count)
        model.filter = .photos
        XCTAssertTrue(model.shown.allSatisfy { $0.kind == .image })
        model.filter = .all
        model.query = "clinic"
        XCTAssertEqual(model.shown.map(\.filename), ["Example clinic letter.pdf"])
    }

    func testAPickedFileIsOnlyUploadedOnceConfirmed() async throws {
        let model = try await makeModel()
        await model.load()
        let before = model.documents.count
        model.pending = .init(kind: .report, data: Data("%PDF-1.4 sample".utf8), filename: "labs.pdf")
        XCTAssertEqual(model.documents.count, before, "nothing is uploaded before confirming")
        let record = await model.confirmPending()
        XCTAssertEqual(record?.status, .processing)
        XCTAssertNil(model.pending)
        XCTAssertEqual(model.documents.count, before + 1)
    }

    func testOfflineLoadSaysSo() async throws {
        let model = try await makeModel()
        Self.offline = true
        await model.load()
        guard case .failed = model.state else { return XCTFail("expected a failed state") }
        XCTAssertTrue(model.isOffline)
    }
}
