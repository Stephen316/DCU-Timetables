import Foundation
import Testing
@testable import DCUTimetable

struct LabRotationTests {

    /// Real rows from the School's PDF, weeks 2 and 3.
    private let json = """
    {"title":"t",
     "modules":{"EEG1001":{"name":"Project & Technical Drawing"},
                "EEG1004":{"name":"Introduction to Electronics"},
                "EEG1002":{"name":"Programming"}},
     "sessions":[
       {"week":3,"date":"2026-09-22","day":"Tue","start":"14:00","end":"17:00","module":"EEG1001","activity":"Workshop","groups":["B"]},
       {"week":3,"date":"2026-09-22","day":"Tue","start":"14:00","end":"17:00","module":"EEG1001","activity":"Drawing","groups":["A"]},
       {"week":3,"date":"2026-09-24","day":"Thu","start":"14:00","end":"17:00","module":"EEG1004","activity":"Lab","groups":["A","B","E"]},
       {"week":2,"date":"2026-09-17","day":"Thu","start":"14:00","end":"17:00","module":"EEG1002","activity":"Lab","groups":["A","B","E"]},
       {"week":3,"date":"2026-09-25","day":"Fri","start":"09:00","end":"12:00","module":"EEG1004","activity":"Lab","groups":["C","D"]},
       {"week":3,"date":"2026-09-24","day":"Thu","start":"14:00","end":"17:00","module":"EEG1001","activity":"Drawing","groups":["C"]}
     ]}
    """

    private func rotation() throws -> LabRotation {
        try JSONDecoder().decode(LabRotation.self, from: Data(json.utf8))
    }

    @Test func listsGroupLetters() throws {
        #expect(try rotation().groupLetters == ["A", "B", "C", "D", "E"])
    }

    @Test func filtersSessionsForGroupInScheduleOrder() throws {
        let a = try rotation().sessions(forGroup: "A")
        #expect(a.map(\.date) == ["2026-09-17", "2026-09-22", "2026-09-24"])
        #expect(a.allSatisfy { $0.groups.contains("A") })
    }

    /// Group C's week 3: Drawing on Thursday at 14:00, Lab on Friday at 09:00. Sorting by
    /// week then time put Friday first, because 09:00 is earlier than 14:00.
    @Test func ordersByDayBeforeTimeOfDay() throws {
        let c = try rotation().sessions(forGroup: "C")
        #expect(c.map(\.day) == ["Thu", "Fri"])
    }

    @Test func exposesModuleNames() throws {
        let r = try rotation()
        #expect(r.name(for: "EEG1004") == "Introduction to Electronics")
        #expect(r.moduleCodes == ["EEG1001", "EEG1002", "EEG1004"])
    }

    /// The case the old model could not hold. Workshop and Drawing are both EEG1001, at the
    /// same hour on the same afternoon, so module-date-start collided.
    @Test func oneModuleRunsTwoActivitiesInOneAfternoon() throws {
        let tuesday = try rotation().sessions.filter { $0.date == "2026-09-22" }
        #expect(tuesday.map(\.module) == ["EEG1001", "EEG1001"])
        #expect(Set(tuesday.map(\.activity)) == ["Workshop", "Drawing"])
        #expect(Set(tuesday.map(\.id)).count == 2)
    }

    @Test func refusesASessionWithoutAnActivity() {
        let old = #"{"title":"t","modules":{},"sessions":[{"week":2,"date":"2026-09-17","day":"Thu","start":"14:00","end":"17:00","module":"EEG1002","groups":["A"]}]}"#
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(LabRotation.self, from: Data(old.utf8))
        }
    }
}

/// Pinned against the School's PDF ("EEG1001 EEG1004 EEG1002 lab rotation 2026-2.pdf"),
/// checked by eye against both rendered pages on 23 Sep 2026.
///
/// These exist because the bundled file was wrong in 35 of 67 sessions and every check
/// that existed at the time passed it. The mistake was structural — Drawing filed under
/// EEG1004, the SG15 & SG16 lab under EEG1002 — so the assertions below are about which
/// module owns which column, not about individual rows. A future hand edit that shifts a
/// column fails here instead of reaching a student's phone.
struct BundledLabRotationTests {

    private func bundled() throws -> LabRotation {
        try #require(LabRotationLoader.bundled(), "EngineeringLabRotation.json did not load")
    }

    @Test func loadsEverySessionWithDistinctIds() throws {
        let r = try bundled()
        #expect(r.sessions.count == 67)
        #expect(Set(r.sessions.map(\.id)).count == 67)
    }

    /// Workshop and Drawing sit under one merged EEG1001 heading; each lab column has its
    /// own module heading.
    @Test func eachColumnBelongsToTheModuleOverIt() throws {
        let r = try bundled()
        for s in r.sessions {
            switch s.activity {
            case "Workshop", "Drawing": #expect(s.module == "EEG1001", "\(s.id)")
            case "Lab": #expect(["EEG1004", "EEG1002"].contains(s.module), "\(s.id)")
            default: Issue.record("unexpected activity \(s.activity) in \(s.id)")
            }
        }
    }

    /// The property that exposed the error: the two labs alternate by week. Filing both
    /// lab columns under EEG1002, as the old file did, left Electronics with no lab at all.
    @Test func theTwoLabsAlternateFortnightly() throws {
        let r = try bundled()
        let weeks = { (m: String) in Set(r.sessions.filter { $0.module == m && $0.activity == "Lab" }.map(\.week)) }
        #expect(weeks("EEG1004") == [3, 5, 7, 9, 11])
        #expect(weeks("EEG1002") == [2, 4, 6, 8, 10, 12])
    }

    @Test func wednesdaysAreGroupEsWorkshop() throws {
        let wednesdays = try bundled().sessions.filter { $0.day == "Wed" }
        #expect(wednesdays.count == 5)
        #expect(wednesdays.allSatisfy { $0.module == "EEG1001" && $0.activity == "Workshop" && $0.groups == ["E"] })
    }

    /// One whole afternoon, cell for cell: Thursday 24 September.
    @Test func thursday24SeptemberMatchesThePDF() throws {
        let day = try bundled().sessions.filter { $0.date == "2026-09-24" }
        let cells = Set(day.map { "\($0.module) \($0.activity) \($0.groups.joined())" })
        #expect(cells == ["EEG1001 Workshop D", "EEG1001 Drawing C", "EEG1004 Lab ABE"])
    }
}
