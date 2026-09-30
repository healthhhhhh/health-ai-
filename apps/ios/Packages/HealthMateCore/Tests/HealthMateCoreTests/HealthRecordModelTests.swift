import Foundation
import XCTest
@testable import HealthMateCore

/// Phase 2A: the health record's dates and provenance decode from the API,
/// and responses from older servers / Preview mode (without them) still decode.
final class HealthRecordModelTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testProfileWithDatesAndUnits() throws {
        let profile = try decode(HealthProfile.self, """
        {"profile":{"firstName":"Sam","lastName":"","dateOfBirth":null,"sex":null,"heightCm":null,"timeZone":"UTC","goals":["sleep"],"unitSystem":"imperial"},
         "conditions":[{"id":"c1","name":"Asthma","status":"active","source":"user_reported","notes":null,"onsetOn":"2010-05-01","resolvedOn":null,"sourceRef":null,"confidence":1,"confirmedAt":null,"createdAt":"2026-09-01T10:00:00.000Z","updatedAt":"2026-09-01T10:00:00.000Z"}],
         "allergies":[{"id":"a1","substance":"Latex","reaction":null,"severity":null,"source":"user_reported","status":"inactive","notedOn":null}],
         "medications":[{"id":"m1","name":"Medication A","instruction":"As directed","source":"user_reported","active":false,"startedOn":"2026-01-10","stoppedOn":"2026-07-28"}]}
        """)
        XCTAssertEqual(profile.profile.unitSystem, .imperial)
        XCTAssertEqual(profile.conditions.first?.onsetOn, "2010-05-01")
        XCTAssertEqual(profile.allergies.first?.status, "inactive")
        XCTAssertEqual(profile.medications.first?.stoppedOn, "2026-07-28")
        XCTAssertFalse(profile.medications.first?.active ?? true)
    }

    func testOlderResponsesStillDecode() throws {
        let profile = try decode(HealthProfile.self, """
        {"profile":{"firstName":"Sam","lastName":"","dateOfBirth":null,"sex":null,"heightCm":null,"timeZone":"UTC"},
         "conditions":[{"id":"c1","name":"Asthma","status":"active","source":"user_reported","notes":null}],
         "allergies":[],"medications":[{"id":"m1","name":"X","instruction":"Y","source":"clinician_provided","active":true}]}
        """)
        XCTAssertNil(profile.profile.unitSystem)
        XCTAssertNil(profile.conditions.first?.onsetOn)
        XCTAssertNil(profile.medications.first?.startedOn)
    }

    func testSupersededMemoryKeepsItsOriginalProvenance() throws {
        let memory = try decode(MemoryRecord.self, """
        {"id":"x","fact":"Allergic to penicilin","source":"user_entry","status":"superseded","priorStatus":"user_reported","supersededBy":"y",
         "occurredOn":"2020-04-01","endedOn":null,"category":"allergy","createdAt":"2026-09-01T10:00:00.000Z"}
        """)
        XCTAssertEqual(memory.status, .superseded)
        XCTAssertEqual(memory.priorStatus, .userReported)
        XCTAssertEqual(memory.supersededBy, "y")
        XCTAssertEqual(memory.occurredOn, "2020-04-01")
        // An AI inference is never labelled as confirmed.
        XCTAssertEqual(MemoryStatus.aiInferred.label, "Unconfirmed suggestion")
    }
}
