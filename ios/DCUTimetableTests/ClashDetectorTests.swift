import Foundation
import Testing
@testable import DCUTimetable

struct ClashDetectorTests {

    private func event(_ id: String, _ startHour: Int, _ endHour: Int) -> TimetableEvent {
        let base = Date(timeIntervalSince1970: 0)
        return TimetableEvent(
            id: id,
            start: base.addingTimeInterval(Double(startHour) * 3600),
            end: base.addingTimeInterval(Double(endHour) * 3600),
            type: .onCampus,
            locations: [],
            moduleName: nil,
            staff: [],
            activity: ActivityCode(""),
            weekLabels: []
        )
    }

    @Test func detectsOverlappingPair() {
        let events = [event("a", 9, 11), event("b", 10, 12), event("c", 13, 14)]
        let clashes = ClashDetector.clashes(in: events)
        #expect(clashes.count == 1)
        #expect(ClashDetector.clashingEventIDs(in: events) == ["a", "b"])
    }

    @Test func adjacentEventsDoNotClash() {
        let events = [event("a", 9, 10), event("b", 10, 11)]
        #expect(ClashDetector.clashes(in: events).isEmpty)
    }

    @Test func detectsTripleOverlap() {
        let events = [event("a", 9, 12), event("b", 10, 11), event("c", 11, 13)]
        // a–b, a–c, b–c? b ends at 11, c starts at 11 → adjacent, no clash. So a–b and a–c.
        #expect(ClashDetector.clashes(in: events).count == 2)
        #expect(ClashDetector.clashingEventIDs(in: events) == ["a", "b", "c"])
    }

    @Test func emptyInputHasNoClashes() {
        #expect(ClashDetector.clashes(in: []).isEmpty)
    }
}
