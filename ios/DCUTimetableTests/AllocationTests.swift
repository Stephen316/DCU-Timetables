import Foundation
import Testing
@testable import DCUTimetable

/// The app's half of supabase/phase13_roster_allocations.sql. The matching itself is tested
/// against the database; these pin what the phone does with the answers.
struct AllocationResolutionTests {

    private func decode(_ json: String) throws -> AllocationResolution {
        try AllocationResolution.decode(Data(json.utf8))
    }

    @Test func matchedCarriesKeyAndVersion() throws {
        let r = try decode(#"[{"status":"matched","allocation_key":"ab12","version":3}]"#)
        #expect(r == .matched(key: "ab12", version: 3))
    }

    @Test func readsEveryOtherStatus() throws {
        #expect(try decode(#"[{"status":"ambiguous","allocation_key":null,"version":1}]"#) == .ambiguous)
        #expect(try decode(#"[{"status":"none","allocation_key":null,"version":1}]"#) == .notListed)
        #expect(try decode(#"[{"status":"conflict","allocation_key":null,"version":1}]"#) == .conflict)
        #expect(try decode(#"[{"status":"no_roster","allocation_key":null,"version":null}]"#) == .noRoster)
    }

    /// Anything the app doesn't recognise must not become a match — the failure a student
    /// can't see is being shown somebody else's labs.
    @Test func unknownOrIncompleteAnswersAreNotMatches() throws {
        #expect(try decode(#"[{"status":"something_new","allocation_key":"ab","version":1}]"#) == .notListed)
        #expect(try decode(#"[{"status":"matched","allocation_key":null,"version":1}]"#) == .notListed)
        #expect(try decode("[]") == .notListed)
    }

    @Test func allocationDecodesTheTableColumnNames() throws {
        let json = #"[{"grp":"B","subgroup":"B.3","day":"Wed","workshop":"SG24","drawing":"SB38"}]"#
        let a = try JSONDecoder().decode([Allocation].self, from: Data(json.utf8)).first
        #expect(a == Allocation(group: "B", subgroup: "B.3", day: "Wed", workshop: "SG24", drawing: "SB38"))
    }
}

struct StudentProfileCompatibilityTests {

    /// Every profile saved before the server matched them has none of the new fields. It
    /// has to keep loading, or updating the app signs everyone out of their timetable.
    @Test func profileSavedBeforePhase13StillDecodes() throws {
        let old = #"{"name":"Student Example","cohort":"engineeringYear1","group":"C","subgroup":"C.2","workshop":"SG25","drawing":"SB39"}"#
        let p = try JSONDecoder().decode(StudentProfile.self, from: Data(old.utf8))
        #expect(p.group == "C")
        #expect(p.courseKey == nil)
        #expect(p.rosterVersion == nil)
    }

    @Test func cohortMapsToTheConsolesProgrammeKey() {
        #expect(StudentProfile.Cohort.engineeringYear1.courseKey == "EEG1")
        #expect(StudentProfile.Cohort(courseKey: "EEG1") == .engineeringYear1)
        #expect(StudentProfile.Cohort(courseKey: "CASE3") == nil)
    }
}

struct AllocationRefreshTests {

    private final class FakeStore: AllocationStore, @unchecked Sendable {
        var rosterList: [RosterSummary]
        var resolution: AllocationResolution
        var row: Allocation?
        var failing = false
        private(set) var resolveCalls = 0

        init(version: Int, resolution: AllocationResolution = .notListed, row: Allocation? = nil) {
            rosterList = [RosterSummary(courseKey: "EEG1", title: "Engineering — Year 1", version: version)]
            self.resolution = resolution
            self.row = row
        }

        func rosters() async throws -> [RosterSummary] {
            if failing { throw URLError(.notConnectedToInternet) }
            return rosterList
        }
        func resolve(courseKey: String, subgroup: String?) async throws -> AllocationResolution {
            resolveCalls += 1
            return resolution
        }
        func allocation(courseKey: String, key: String) async throws -> Allocation? { row }
        func subgroups(courseKey: String) async throws -> [String] { [] }
    }

    private let profile = StudentProfile(
        name: "Student Example", cohort: .engineeringYear1,
        allocation: Allocation(group: "A", subgroup: "A.1", workshop: "SG23", drawing: "SB39"),
        allocationKey: "aa", rosterVersion: 2)

    @Test func sameVersionIsNotResolvedAgain() async {
        let store = FakeStore(version: 2)
        #expect(await AllocationRefresh.check(profile, store: store) == .unchanged)
        #expect(store.resolveCalls == 0)
    }

    @Test func newVersionReplacesTheAllocation() async {
        let store = FakeStore(version: 3, resolution: .matched(key: "bb", version: 3),
                              row: Allocation(group: "B", subgroup: "B.2", workshop: "SG24", drawing: "SB38"))
        guard case .updated(let p) = await AllocationRefresh.check(profile, store: store) else {
            Issue.record("expected an update")
            return
        }
        #expect(p.group == "B")
        #expect(p.drawing == "SB38")
        #expect(p.rosterVersion == 3)
        #expect(p.name == profile.name)
    }

    @Test func removedFromTheListDropsTheProfile() async {
        #expect(await AllocationRefresh.check(profile, store: FakeStore(version: 3, resolution: .notListed)) == .dropped)
        #expect(await AllocationRefresh.check(profile, store: FakeStore(version: 3, resolution: .conflict)) == .dropped)
    }

    @Test func deletedRosterDropsTheProfile() async {
        let store = FakeStore(version: 2)
        store.rosterList = []
        #expect(await AllocationRefresh.check(profile, store: store) == .dropped)
    }

    /// Offline must not cost a student their timetable.
    @Test func networkFailureKeepsTheProfile() async {
        let store = FakeStore(version: 3)
        store.failing = true
        #expect(await AllocationRefresh.check(profile, store: store) == .unchanged)
    }

    @Test func profilesFromBeforeTheServerAreLeftAlone() async {
        let legacy = StudentProfile(name: "Student Example", group: "D")
        let store = FakeStore(version: 9)
        #expect(await AllocationRefresh.check(legacy, store: store) == .unchanged)
        #expect(store.resolveCalls == 0)
    }
}
