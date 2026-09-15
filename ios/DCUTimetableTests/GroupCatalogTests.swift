import Foundation
import Testing
@testable import DCUTimetable

struct GroupCatalogTests {

    private func event(_ code: String, module: String? = nil) -> TimetableEvent {
        TimetableEvent(
            id: UUID().uuidString,
            start: Date(),
            end: Date().addingTimeInterval(3600),
            type: .onCampus,
            locations: [],
            moduleName: module,
            staff: [],
            activity: ActivityCode(code),
            weekLabels: []
        )
    }

    @Test func offersOnlyChoosableStreamsNotLectures() {
        let events = [
            event("EEG1001[1]OC/L1/01", module: "Project & Technical Drawing"), // lecture: excluded
            event("EEG1001[1]OC/P1/01", module: "Project & Technical Drawing"),
            event("EEG1001[1]OC/P2/01", module: "Project & Technical Drawing"),
            event("EEG1001[1]OC/P1/01", module: "Project & Technical Drawing"), // repeat week
        ]
        let modules = GroupCatalog.modules(from: events)
        #expect(modules.count == 1)
        #expect(modules[0].moduleCode == "EEG1001")
        #expect(modules[0].groups.count == 2) // P1, P2 — lecture dropped, duplicate P1 collapsed
    }

    @Test func moduleWithOnlyLecturesIsOmitted() {
        let events = [event("EEG1006[1]OC/L1/01"), event("EEG1006[1]OC/L2/01")]
        #expect(GroupCatalog.modules(from: events).isEmpty)
    }

    @Test func crossListedCodeParsesCleanly() {
        let a = ActivityCode("CHM1006[1]OC/L1/01, EEG1017[1]OC/L1/01")
        #expect(a.moduleCode == "CHM1006")
        #expect(a.group == "01")          // trailing comma stripped
        #expect(a.cohort == nil)          // second code is not a cohort
    }

    @Test func surnameSplitsAreDistinctGroups() {
        let a = event("BIO1000[1]OC/T1/01 Surname A - M", module: "How life works 1")
        let b = event("BIO1000[1]OC/T1/01 Surname N - Z", module: "How life works 1")
        let modules = GroupCatalog.modules(from: [a, b])
        #expect(modules[0].groups.count == 2)
    }

    @Test func filterHidesSelectedGroups() {
        let p1 = event("EEG1001[1]OC/P1/01")
        let p2 = event("EEG1001[1]OC/P2/01")
        let filtered = GroupCatalog.filter([p1, p2], hiding: [p2.groupKey])
        #expect(filtered.count == 1)
        #expect(filtered.first?.groupKey == p1.groupKey)
    }

    @Test func emptyHiddenShowsEverything() {
        let p1 = event("EEG1001[1]OC/P1/01")
        #expect(GroupCatalog.filter([p1], hiding: []).count == 1)
    }
}
