import Foundation
import Testing
@testable import DCUTimetable

struct DeadlineScheduleTests {

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Dublin")!
        return cal
    }()

    /// Wednesday 16 September 2026. That week runs Mon 14 – Sun 20.
    private let now = DateComponents(calendar: Calendar(identifier: .gregorian),
                                     timeZone: TimeZone(identifier: "Europe/Dublin"),
                                     year: 2026, month: 9, day: 16, hour: 10).date!

    private func date(_ day: Int, month: Int = 9, hour: Int = 12) -> Date {
        DateComponents(calendar: Calendar(identifier: .gregorian),
                       timeZone: TimeZone(identifier: "Europe/Dublin"),
                       year: 2026, month: month, day: day, hour: hour).date!
    }

    private func deadline(_ title: String, on day: Int, month: Int = 9,
                          hour: Int = 12, kind: DeadlineKind = .assignment) -> Deadline {
        Deadline(moduleKey: "EEG1001", title: title, due: date(day, month: month, hour: hour),
                 kind: kind, submitterID: "someone")
    }

    private func section(_ day: Int, month: Int = 9, hour: Int = 12) -> DeadlineSection {
        DeadlineSchedule.section(for: date(day, month: month, hour: hour),
                                 now: now, calendar: calendar)
    }

    @Test func bucketsByHowSoonItIs() {
        #expect(section(16) == .today)
        #expect(section(16, hour: 9) == .today)      // earlier today still counts
        #expect(section(18) == .thisWeek)            // Friday
        #expect(section(20) == .thisWeek)            // Sunday closes the teaching week
        #expect(section(21) == .nextWeek)            // the following Monday
        #expect(section(27) == .nextWeek)
        #expect(section(28) == .later)
        #expect(section(14, month: 12) == .later)
    }

    /// Weeks run Monday–Sunday whatever the device's locale says: on a Sunday-first
    /// calendar, Friday's assignment would fall into "next week".
    @Test func weeksRunMondayToSunday() {
        var americanCalendar = Calendar(identifier: .gregorian)
        americanCalendar.timeZone = TimeZone(identifier: "Europe/Dublin")!
        americanCalendar.firstWeekday = 1           // Sunday
        let friday = DeadlineSchedule.section(for: date(18), now: now, calendar: americanCalendar)
        #expect(friday == .thisWeek)
    }

    @Test func groupsInOrderAndDropsEmptySections() {
        let list = [
            deadline("Exam", on: 14, month: 12, kind: .exam),
            deadline("Quiz", on: 16, kind: .quiz),
            deadline("Lab report", on: 18, kind: .labReport),
            deadline("Last term's essay", on: 1),
        ]
        let grouped = DeadlineSchedule.grouped(list, now: now, calendar: calendar)

        #expect(grouped.map(\.section) == [.today, .thisWeek, .later])
        #expect(grouped.flatMap { $0.deadlines }.map(\.title) == ["Quiz", "Lab report", "Exam"])
    }

    @Test func separatesWhatIsSatInARoom() {
        let list = [
            deadline("Quiz", on: 16, kind: .quiz),
            deadline("Exam", on: 17, kind: .exam),
            deadline("Assignment", on: 18),
            deadline("Lab report", on: 19, kind: .labReport),
        ]
        #expect(DeadlineSchedule.sitInClass(list).map(\.title) == ["Quiz", "Exam"])
    }
}
