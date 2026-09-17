import Foundation
import Testing
@testable import DCUTimetable

struct DefaultDayTests {

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Dublin")!
        return cal
    }()

    /// Monday 14 September 2026.
    private let weekStart = DateComponents(calendar: Calendar(identifier: .gregorian),
                                           timeZone: TimeZone(identifier: "Europe/Dublin"),
                                           year: 2026, month: 9, day: 14).date!

    private func date(day: Int, hour: Int) -> Date {
        DateComponents(calendar: Calendar(identifier: .gregorian),
                       timeZone: TimeZone(identifier: "Europe/Dublin"),
                       year: 2026, month: 9, day: day, hour: hour).date!
    }

    private func target(day: Int, hour: Int, weekStart: Date? = nil) -> DefaultDay.Target {
        DefaultDay.target(weekStart: weekStart ?? self.weekStart,
                          now: date(day: day, hour: hour),
                          calendar: calendar)
    }

    @Test func opensOnTodayDuringTheDay() {
        #expect(target(day: 14, hour: 9) == .init(weekStep: 0, dayIndex: 0))    // Mon → Mon
        #expect(target(day: 16, hour: 13) == .init(weekStep: 0, dayIndex: 2))   // Wed → Wed
        #expect(target(day: 16, hour: 17) == .init(weekStep: 0, dayIndex: 2))   // 5pm is still today
    }

    @Test func rollsOverToTomorrowFromSixPM() {
        #expect(target(day: 16, hour: 18) == .init(weekStep: 0, dayIndex: 3))   // Wed 6pm → Thu
        #expect(target(day: 16, hour: 23) == .init(weekStep: 0, dayIndex: 3))
        #expect(target(day: 14, hour: 20) == .init(weekStep: 0, dayIndex: 1))   // Mon eve → Tue
    }

    /// The bug this replaced: Friday evening landed on day 0 of the week already on screen,
    /// which is the Monday four days *behind* the student.
    @Test func fridayEveningAndWeekendsGoToNextMonday() {
        #expect(target(day: 18, hour: 9) == .init(weekStep: 0, dayIndex: 4))    // Fri → Fri
        #expect(target(day: 18, hour: 19) == .init(weekStep: 1, dayIndex: 0))   // Fri eve → next Mon
        #expect(target(day: 19, hour: 11) == .init(weekStep: 1, dayIndex: 0))   // Saturday
        #expect(target(day: 20, hour: 21) == .init(weekStep: 1, dayIndex: 0))   // Sunday evening
    }

    /// Stepping a week changes `weekStart`, which asks again — the second answer must not
    /// step a third time, or the pager never stops moving.
    @Test func settlesAfterSteppingAWeek() {
        let nextMonday = date(day: 21, hour: 0)
        #expect(target(day: 18, hour: 19, weekStart: nextMonday) == .init(weekStep: 0, dayIndex: 0))
        #expect(target(day: 20, hour: 21, weekStart: nextMonday) == .init(weekStep: 0, dayIndex: 0))
    }

    /// Paged off to some other week: Monday of what's on screen, and no stepping.
    @Test func pagedAwayLandsOnMondayWithoutMoving() {
        let farFuture = date(day: 28, hour: 0)
        let past = date(day: 7, hour: 0)
        #expect(target(day: 16, hour: 13, weekStart: farFuture) == .init(weekStep: 0, dayIndex: 0))
        #expect(target(day: 16, hour: 13, weekStart: past) == .init(weekStep: 0, dayIndex: 0))
    }
}
