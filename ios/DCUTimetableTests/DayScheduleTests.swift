import Foundation
import Testing
@testable import DCUTimetable

struct DayScheduleTests {

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Dublin")!
        return cal
    }()

    private func at(_ hour: Int, _ minute: Int = 0) -> Date {
        DateComponents(calendar: Calendar(identifier: .gregorian),
                       timeZone: TimeZone(identifier: "Europe/Dublin"),
                       year: 2026, month: 9, day: 18, hour: hour, minute: minute).date!
    }

    private func event(_ id: String, _ from: Date, _ to: Date) -> TimetableEvent {
        TimetableEvent(id: id, start: from, end: to, type: .onCampus, locations: [],
                       moduleName: nil, staff: [], activity: ActivityCode("EEG1001[1]L1"),
                       weekLabels: [])
    }

    private func gaps(_ slots: [DaySlot]) -> [DayGap] {
        slots.compactMap { if case .gap(let gap) = $0 { return gap } else { return nil } }
    }

    @Test func fillsTheSpaceBetweenClasses() {
        let slots = DaySchedule.slots(for: [
            event("a", at(9), at(10)),
            event("b", at(13), at(14)),
        ])
        #expect(slots.map(\.id) == ["a", "gap-\(at(10).timeIntervalSince1970)", "b"])
        #expect(gaps(slots).map(\.label) == ["3 hours free"])
    }

    /// The whole point of the feature: a long empty stretch is one row, not one per hour.
    @Test func aLongGapIsASingleCondensedRow() {
        let slots = DaySchedule.slots(for: [
            event("a", at(9), at(10)),
            event("b", at(15), at(16)),
        ])
        #expect(gaps(slots).count == 1)
        #expect(gaps(slots).first?.label == "5 hours free")
    }

    @Test func ignoresTheWalkBetweenRooms() {
        let backToBack = DaySchedule.slots(for: [
            event("a", at(9), at(10)),
            event("b", at(10), at(11)),
        ])
        #expect(gaps(backToBack).isEmpty)

        let changeover = DaySchedule.slots(for: [
            event("a", at(9), at(9, 50)),
            event("b", at(10), at(11)),
        ])
        #expect(gaps(changeover).isEmpty)          // 10 minutes is not free time

        let real = DaySchedule.slots(for: [
            event("a", at(9), at(9, 45)),
            event("b", at(10), at(11)),
        ])
        #expect(gaps(real).map(\.label) == ["15 min free"])
    }

    /// Two lectures that overlap must not produce a gap running backwards. The next gap is
    /// measured from the later of the two ends, not from whichever came second in the list.
    @Test func overlappingClassesDoNotInventAGap() {
        let slots = DaySchedule.slots(for: [
            event("long", at(9), at(12)),
            event("short", at(10), at(11)),
            event("after", at(13), at(14)),
        ])
        #expect(gaps(slots).count == 1)
        #expect(gaps(slots).first?.start == at(12))   // from the longer class's end
        #expect(gaps(slots).first?.label == "1 hour free")
    }

    @Test func nothingIsAddedBeforeTheFirstOrAfterTheLast() {
        let slots = DaySchedule.slots(for: [event("only", at(11), at(12))])
        #expect(slots.count == 1)
        #expect(gaps(slots).isEmpty)
        #expect(DaySchedule.slots(for: []).isEmpty)
    }

    @Test func wordsTheDurationTheWayAStudentWouldSayIt() {
        #expect(DaySchedule.freeLabel(minutes: 20) == "20 min free")
        #expect(DaySchedule.freeLabel(minutes: 60) == "1 hour free")
        #expect(DaySchedule.freeLabel(minutes: 120) == "2 hours free")
        #expect(DaySchedule.freeLabel(minutes: 150) == "2 hr 30 min free")
    }

    @Test func totalsTheFreeTimeForTheDayHeader() {
        let slots = DaySchedule.slots(for: [
            event("a", at(9), at(10)),
            event("b", at(12), at(13)),
            event("c", at(16), at(17)),
        ])
        #expect(DaySchedule.freeMinutes(in: slots) == 300)   // 2 hours + 3 hours
    }
}
