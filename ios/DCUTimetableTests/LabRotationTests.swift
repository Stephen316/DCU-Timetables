import Foundation
import Testing
@testable import DCUTimetable

struct LabRotationTests {

    private let json = """
    {"title":"t",
     "modules":{"EEG1001":{"name":"Project & Technical Drawing","activity":"Workshop"},
                "EEG1004":{"name":"Introduction to Electronics","activity":"Drawing"}},
     "sessions":[
       {"week":3,"date":"2026-09-22","day":"Tue","start":"14:00","end":"17:00","module":"EEG1001","groups":["B"]},
       {"week":3,"date":"2026-09-22","day":"Tue","start":"14:00","end":"17:00","module":"EEG1004","groups":["A"]},
       {"week":3,"date":"2026-09-24","day":"Thu","start":"14:00","end":"17:00","module":"EEG1001","groups":["D"]},
       {"week":2,"date":"2026-09-17","day":"Thu","start":"14:00","end":"17:00","module":"EEG1004","groups":["A","B","E"]}
     ]}
    """

    private func rotation() throws -> LabRotation {
        try JSONDecoder().decode(LabRotation.self, from: Data(json.utf8))
    }

    @Test func listsGroupLetters() throws {
        #expect(try rotation().groupLetters == ["A", "B", "D", "E"])
    }

    @Test func filtersSessionsForGroupInScheduleOrder() throws {
        let r = try rotation()
        let a = r.sessions(forGroup: "A")
        #expect(a.count == 2)                       // week 2 EEG1004 + week 3 EEG1004
        #expect(a.first?.week == 2)                 // sorted by week then time
        #expect(a.allSatisfy { $0.groups.contains("A") })
    }

    @Test func exposesModuleMetadata() throws {
        let r = try rotation()
        #expect(r.activity(for: "EEG1001") == "Workshop")
        #expect(r.name(for: "EEG1004") == "Introduction to Electronics")
        #expect(r.moduleCodes == ["EEG1001", "EEG1004"])
    }
}
