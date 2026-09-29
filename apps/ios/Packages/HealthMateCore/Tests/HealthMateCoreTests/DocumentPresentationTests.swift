import Foundation
@testable import HealthMateCore
import XCTest

final class DocumentPresentationTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func doc(_ id: String, kind: DocumentKind = .report, filename: String = "labs.pdf", status: DocumentStatus = .ready, age: TimeInterval = 0, result: AnalysisResult? = nil) -> DocumentRecord {
        DocumentRecord(id: id, kind: kind, purpose: kind == .image ? .skin : nil, filename: filename, contentType: "application/pdf", byteSize: 1000, status: status, failureReason: nil, result: result, createdAt: now.addingTimeInterval(-age), processedAt: nil)
    }

    private func finding(_ name: String, _ flag: ReportFinding.Flag) -> ReportFinding {
        ReportFinding(name: name, value: "1", unit: nil, referenceRange: nil, flag: flag, page: 1, explanation: "")
    }

    func testFiltersByKindAndSearchesNamesNewestFirst() {
        let docs = [doc("a", filename: "Blood test.pdf", age: 100), doc("b", kind: .image, filename: "arm.jpg", age: 50), doc("c", filename: "Letter.pdf", age: 10)]
        XCTAssertEqual(DocumentFilter.all.apply(docs).map(\.id), ["c", "b", "a"])
        XCTAssertEqual(DocumentFilter.reports.apply(docs).map(\.id), ["c", "a"])
        XCTAssertEqual(DocumentFilter.photos.apply(docs).map(\.id), ["b"])
        XCTAssertEqual(DocumentFilter.all.apply(docs, query: " blood ").map(\.id), ["a"])
        // Photos are found by their title too.
        XCTAssertEqual(DocumentFilter.all.apply(docs, query: "rash").map(\.id), ["b"])
        XCTAssertTrue(DocumentFilter.reports.apply(docs, query: "zzz").isEmpty)
    }

    func testProgressStepsFollowTheStatus() {
        XCTAssertEqual(DocumentPresentation.currentStep(doc("a", status: .awaitingUpload), now: now), 0)
        XCTAssertEqual(DocumentPresentation.currentStep(doc("a", status: .processing, age: 2), now: now), 1)
        XCTAssertEqual(DocumentPresentation.currentStep(doc("a", status: .processing, age: 20), now: now), 2)
        XCTAssertEqual(DocumentPresentation.currentStep(doc("a", status: .ready), now: now), DocumentPresentation.steps.count)
    }

    func testCountsCompareWithThePrintedRangeOnly() {
        let findings = [finding("A", .withinRange), finding("B", .high), finding("C", .withinRange), finding("D", .notStated), finding("E", .low)]
        let counts = DocumentPresentation.counts(findings)
        XCTAssertEqual(counts, .init(within: 2, outside: 2, noRange: 1))
        let line = DocumentPresentation.countsLine(counts)
        XCTAssertEqual(line, "2 within the report's range · 2 outside it · 1 with no range given")
        for word in ["normal", "abnormal", "healthy"] {
            XCTAssertFalse(line.lowercased().contains(word))
            for flag in [ReportFinding.Flag.withinRange, .high, .low, .abnormal, .notStated] {
                XCTAssertFalse(DocumentPresentation.flagLabel(flag).lowercased().contains(word))
            }
        }
        XCTAssertEqual(DocumentPresentation.ordered(findings).map(\.name), ["B", "E", "A", "C", "D"])
    }

    func testQuestionsTextSaysWhereItCameFrom() {
        let text = DocumentPresentation.questionsText(doc("a", filename: "labs.pdf"), questions: ["What does it mean?", "Repeat test?"], sample: true)
        XCTAssertTrue(text.contains("1. What does it mean?\n2. Repeat test?"))
        XCTAssertTrue(text.contains("labs.pdf"))
        XCTAssertTrue(text.contains("Sample questions"))
        XCTAssertTrue(DocumentPresentation.questionsText(doc("a"), questions: ["Q"], sample: false).contains("Not a diagnosis"))
    }

    func testByteSizes() {
        XCTAssertEqual(DocumentPresentation.byteSize(500), "500 B")
        XCTAssertEqual(DocumentPresentation.byteSize(284_311), "278 KB")
        XCTAssertEqual(DocumentPresentation.byteSize(1_204_551), "1.1 MB")
    }
}
