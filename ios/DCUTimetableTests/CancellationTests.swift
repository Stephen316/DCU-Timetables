import Foundation
import Testing
@testable import DCUTimetable

struct CancellationTests {

    private func event(_ code: String, startHour: Int) -> TimetableEvent {
        var comps = DateComponents(year: 2026, month: 9, day: 16, hour: startHour)
        comps.timeZone = TimeZone(secondsFromGMT: 0)
        let start = Calendar(identifier: .gregorian).date(from: comps)!
        return TimetableEvent(id: UUID().uuidString, start: start,
                              end: start.addingTimeInterval(3600), type: .onCampus,
                              locations: [], moduleName: nil, staff: [],
                              activity: ActivityCode(code), weekLabels: [])
    }

    @Test func eventKeyIsStableAcrossDevicesButUniquePerOccurrence() {
        let nine = event("EEG1006[1]OC/L1/01", startHour: 9)
        let sameAgain = event("EEG1006[1]OC/L1/01", startHour: 9)
        let later = event("EEG1006[1]OC/L1/01", startHour: 11)

        // Same class, same slot → same bucket even though the event ids differ.
        #expect(CancellationRules.eventKey(for: nine) == CancellationRules.eventKey(for: sameAgain))
        // A different slot of the same module must not share the bucket.
        #expect(CancellationRules.eventKey(for: nine) != CancellationRules.eventKey(for: later))
    }

    @Test func flagsOnlyAtTheThreshold() {
        let key = "k"
        func reports(_ ids: [String]) -> [CancellationReport] {
            ids.map { CancellationReport(eventKey: key, reporterID: $0) }
        }
        #expect(CancellationRules.status(forKey: key, reports: reports(["a", "b"]), reporterID: "z").isFlagged == false)
        #expect(CancellationRules.status(forKey: key, reports: reports(["a", "b", "c"]), reporterID: "z").isFlagged)
    }

    @Test func oneDeviceCannotFlagAClassAlone() {
        let key = "k"
        // Same reporter submitting repeatedly must count once.
        let spam = (0..<5).map { _ in CancellationReport(eventKey: key, reporterID: "me") }
        let status = CancellationRules.status(forKey: key, reports: spam, reporterID: "me")
        #expect(status.reportCount == 1)
        #expect(status.isFlagged == false)
        #expect(status.reportedByMe)
    }

    @Test func reportsForOtherClassesDoNotLeak() {
        let reports = [
            CancellationReport(eventKey: "a", reporterID: "1"),
            CancellationReport(eventKey: "a", reporterID: "2"),
            CancellationReport(eventKey: "b", reporterID: "3"),
        ]
        let all = CancellationRules.statuses(from: reports, reporterID: "1")
        #expect(all["a"]?.reportCount == 2)
        #expect(all["a"]?.reportedByMe == true)
        #expect(all["b"]?.reportCount == 1)
        #expect(all["b"]?.reportedByMe == false)
    }
}
