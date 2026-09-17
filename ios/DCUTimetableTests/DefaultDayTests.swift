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

    private func index(day: Int, hour: Int) -> Int {
        DefaultDay.index(weekStart: weekStart, now: date(day: day, hour: hour), calendar: calendar)
    }

    @Test func opensOnTodayDuringTheDay() {
        #expect(index(day: 14, hour: 9) == 0)    // Monday morning → Monday
        #expect(index(day: 16, hour: 13) == 2)   // Wednesday lunchtime → Wednesday
        #expect(index(day: 16, hour: 17) == 2)   // 5pm is still today
    }

    @Test func rollsOverToTomorrowFromSixPM() {
        #expect(index(day: 16, hour: 18) == 3)   // Wednesday 6pm → Thursday
        #expect(index(day: 16, hour: 23) == 3)
        #expect(index(day: 14, hour: 20) == 1)   // Monday evening → Tuesday
    }

    @Test func fridayEveningAndWeekendsFallToMonday() {
        #expect(index(day: 18, hour: 9) == 4)    // Friday morning → Friday
        #expect(index(day: 18, hour: 19) == 0)   // Friday evening → Monday
        #expect(index(day: 19, hour: 11) == 0)   // Saturday
        #expect(index(day: 20, hour: 21) == 0)   // Sunday evening
    }
}
