import Foundation
import Testing
@testable import DCUTimetable

/// Which day the timetable widget shows: today until its last class ends, then the next
/// day that has any.
struct WidgetDisplayDayTests {

    /// September 2026: the 25th is a Friday, the 28th the Monday after.
    private static func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: day,
                                                   hour: hour, minute: minute))!
    }

    private static func item(_ id: String, day: Int, from start: Int, to end: Int) -> WidgetClass {
        WidgetClass(id: id, title: id, code: "CA106", room: "HG20",
                    start: at(day, start), end: at(day, end))
    }

    private static let friday = [item("fri-9", day: 25, from: 9, to: 11),
                                 item("fri-14", day: 25, from: 14, to: 16)]
    private static let monday = [item("mon-10", day: 28, from: 10, to: 11),
                                 item("mon-12", day: 28, from: 12, to: 13)]
    private static let snapshot = WidgetSnapshot(classes: friday + monday, deadlines: [])

    @Test func todayIsShownWhileAClassIsStillToFinish() {
        let shown = Self.snapshot.displayDay(at: Self.at(25, 15, 59))
        #expect(shown.day == Calendar.current.startOfDay(for: Self.at(25, 0)))
        #expect(shown.classes.map(\.id) == ["fri-9", "fri-14"])
    }

    @Test func theNextClassDayIsShownOnceTheLastClassEnds() {
        let shown = Self.snapshot.displayDay(at: Self.at(25, 16))
        #expect(shown.day == Calendar.current.startOfDay(for: Self.at(28, 0)))
        #expect(shown.classes.map(\.id) == ["mon-10", "mon-12"])
    }

    @Test func aDayWithNoClassesShowsTheNextOneThatHasThem() {
        let shown = Self.snapshot.displayDay(at: Self.at(26, 12))
        #expect(shown.classes.map(\.id) == ["mon-10", "mon-12"])
    }

    @Test func beforeTheFirstClassTodayIsStillToday() {
        let shown = Self.snapshot.displayDay(at: Self.at(25, 6))
        #expect(shown.classes.map(\.id) == ["fri-9", "fri-14"])
    }

    @Test func withNothingFurtherAheadItStaysOnToday() {
        let onlyFriday = WidgetSnapshot(classes: Self.friday, deadlines: [])
        let shown = onlyFriday.displayDay(at: Self.at(25, 17))
        #expect(shown.day == Calendar.current.startOfDay(for: Self.at(25, 0)))
        #expect(shown.classes.map(\.id) == ["fri-9", "fri-14"])
    }

    @Test func aClassLaterTheSameDayNeverCountsAsTheNextDay() {
        // Only whole days after today qualify, so an evening class can't be skipped past.
        let shown = Self.snapshot.displayDay(at: Self.at(25, 11, 30))
        #expect(shown.classes.map(\.id) == ["fri-9", "fri-14"])
    }
}
