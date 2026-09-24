import Foundation
import Testing
@testable import DCUTimetable

/// The app's half of supabase/phase17_timetable_changes.sql: which changes reach which
/// student, and what they do to a week.
struct TimetableChangeApplyTests {

    /// 14:00 Dublin on 14 Oct 2026 (IST, UTC+1) — DCU sends it as 13:00 UTC.
    private func event(_ code: String, _ date: String, _ time: String) -> TimetableEvent {
        let start = DublinTime.date(date, time)!
        return TimetableEvent(id: "\(code)-\(date)-\(time)", start: start, end: start.addingTimeInterval(3 * 3600),
                              type: .onCampus, locations: [], moduleName: nil, staff: [],
                              activity: ActivityCode(code), weekLabels: [])
    }

    private let lab = "EEG1002[1]OC/P1/02"
    private let otherLab = "EEG1002[1]OC/P1/01"
    private let groupC = TimetableAudience(courseKey: "EEG1", group: "C", subgroup: "C.2")

    private func remove(group: String? = nil, code: String? = nil, dates: [String] = ["2026-10-14"],
                        course: String = "EEG1") -> TimetableChange {
        TimetableChange(id: UUID().uuidString, courseKey: course, group: group, kind: .remove,
                        module: "EEG1002", activityCode: code, dates: dates, start: "14:00")
    }

    @Test func aRemovalForTheGroupHidesTheClass() {
        let week = [event(lab, "2026-10-14", "14:00"), event(lab, "2026-10-21", "14:00")]
        let out = TimetableChanges.apply(week, changes: [remove(group: "C")], audience: groupC, weekStart: nil)
        #expect(out.map(\.id) == [week[1].id])
    }

    @Test func aRemovalForAnotherGroupLeavesItAlone() {
        let week = [event(lab, "2026-10-14", "14:00")]
        #expect(TimetableChanges.apply(week, changes: [remove(group: "D")], audience: groupC, weekStart: nil) == week)
    }

    @Test func aSubgroupRemovalReachesOnlyThatSubgroup() {
        let week = [event(lab, "2026-10-14", "14:00")]
        #expect(TimetableChanges.apply(week, changes: [remove(group: "C.2")], audience: groupC, weekStart: nil).isEmpty)
        #expect(TimetableChanges.apply(week, changes: [remove(group: "C.1")], audience: groupC, weekStart: nil) == week)
    }

    /// A student on a picked programme has no group: only changes for everyone reach them.
    @Test func noGroupSeesOnlyChangesForEveryone() {
        let week = [event(lab, "2026-10-14", "14:00")]
        let picked = TimetableAudience(courseKey: "EEG1")
        #expect(TimetableChanges.apply(week, changes: [remove(group: "C")], audience: picked, weekStart: nil) == week)
        #expect(TimetableChanges.apply(week, changes: [remove()], audience: picked, weekStart: nil).isEmpty)
    }

    @Test func anotherCoursesChangesDontApply() {
        let week = [event(lab, "2026-10-14", "14:00")]
        #expect(TimetableChanges.apply(week, changes: [remove(course: "CASE1")], audience: groupC, weekStart: nil) == week)
    }

    @Test func anActivityCodeNarrowsTheRemoval() {
        let week = [event(lab, "2026-10-14", "14:00"), event(otherLab, "2026-10-14", "14:00")]
        let out = TimetableChanges.apply(week, changes: [remove(code: lab)], audience: groupC, weekStart: nil)
        #expect(out.map(\.id) == [week[1].id])
    }

    /// DCU's activity names carry a week-pattern suffix; the console matches the code alone.
    @Test func theCodeIgnoresTheWeekSuffix() {
        let week = [event("\(lab) <2, 4, 6>", "2026-10-14", "14:00")]
        #expect(TimetableChanges.apply(week, changes: [remove(code: lab)], audience: groupC, weekStart: nil).isEmpty)
    }

    @Test func aDifferentStartIsNotRemoved() {
        let week = [event(lab, "2026-10-14", "09:00")]
        #expect(TimetableChanges.apply(week, changes: [remove()], audience: groupC, weekStart: nil) == week)
    }

    @Test func anAdditionLandsInItsWeekOnly() {
        let add = TimetableChange(id: "a1", courseKey: "EEG1", group: "C", kind: .add, module: "EEG1004",
                                  title: "Make-up lab", dates: ["2026-10-16", "2026-10-23"],
                                  start: "10:00", end: "12:00", room: "S205")
        let monday = DublinTime.date("2026-10-12", "00:00")!
        let out = TimetableChanges.apply([], changes: [add], audience: groupC, weekStart: monday)
        #expect(out.count == 1)
        #expect(out.first?.start == DublinTime.date("2026-10-16", "10:00"))
        #expect(out.first?.locations == ["S205"])
        #expect(out.first?.moduleCode == "EEG1004")
        #expect(DublinTime.timeString(out.first!.start) == "10:00")
    }

    @Test func noAudienceChangesNothing() {
        let week = [event(lab, "2026-10-14", "14:00")]
        #expect(TimetableChanges.apply(week, changes: [remove()], audience: nil, weekStart: nil) == week)
    }

    @Test func pickedEngineeringProgrammesMapToTheirCourse() {
        #expect(TimetableAudience.forProgramme(code: "ECE1")?.courseKey == "EEG1")
        #expect(TimetableAudience.forProgramme(code: "CASE3") == nil)
    }

    @Test func decodesARow() throws {
        let json = """
        [{"id":"x","course_key":"EEG1","grp":null,"kind":"remove","module":"EEG1002","activity_code":null,
          "title":null,"dates":["2026-10-14"],"start_time":"14:00","end_time":null,"room":null}]
        """
        let rows = try JSONDecoder().decode([TimetableChange].self, from: Data(json.utf8))
        #expect(rows.first?.group == nil)
        #expect(rows.first?.kind == .remove)
    }
}

struct TimetableChangeRefreshTests {

    private final class FakeStore: TimetableChangeStore, @unchecked Sendable {
        var list: [TimetableChange]
        var failing = false
        init(_ list: [TimetableChange]) { self.list = list }
        func changes(courseKey: String) async throws -> [TimetableChange] {
            if failing { throw URLError(.notConnectedToInternet) }
            return list
        }
    }

    private let change = TimetableChange(id: "1", courseKey: "EEG1", kind: .remove, module: "EEG1002",
                                         dates: ["2026-10-14"], start: "14:00")

    private func freshCache() -> TimetableChangeCache {
        TimetableChangeCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("TimetableChangeTests-\(UUID().uuidString)", isDirectory: true))
    }

    @Test func newChangesAreCachedOnce() async {
        let cache = freshCache()
        let store = FakeStore([change])
        #expect(await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache))
        #expect(await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache) == false)
        #expect(cache.changes(courseKey: "EEG1") == [change])
    }

    /// Offline must not bring a removed class back.
    @Test func aFailedRequestKeepsTheCache() async {
        let cache = freshCache()
        let store = FakeStore([change])
        _ = await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache)
        store.failing = true
        #expect(await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache) == false)
        #expect(cache.changes(courseKey: "EEG1") == [change])
    }

    @Test func deletingTheLastChangeClearsIt() async {
        let cache = freshCache()
        let store = FakeStore([change])
        _ = await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache)
        store.list = []
        #expect(await TimetableChangeRefresh.run(courseKey: "EEG1", store: store, cache: cache))
        #expect(cache.changes(courseKey: "EEG1").isEmpty)
    }
}
