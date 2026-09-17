import Foundation

/// Which weekday the day view opens on.
///
/// Today, except that from 6pm the day is effectively over — nobody opening the app on a
/// Tuesday evening wants Tuesday's finished lectures, they're checking what's on tomorrow.
/// A weekend rolls forward to the next Monday, which is why the answer can't be a bare day
/// index: on Friday evening the day wanted is in the *following* week.
public enum DefaultDay {
    /// From this hour the next teaching day is shown instead of today.
    public static let rolloverHour = 18

    /// Where to land: how many weeks to move from the one on screen, and which Mon–Fri
    /// column once there.
    public struct Target: Equatable, Sendable {
        /// 0 = the week already on screen, 1 = the week after it.
        public let weekStep: Int
        /// 0 = Monday.
        public let dayIndex: Int

        public init(weekStep: Int, dayIndex: Int) {
            self.weekStep = weekStep
            self.dayIndex = dayIndex
        }
    }

    public static func target(weekStart: Date, now: Date = Date(),
                              calendar: Calendar = .current) -> Target {
        let day = teachingDay(from: now, calendar: calendar)
        let offset = calendar.dateComponents([.day],
                                             from: calendar.startOfDay(for: weekStart),
                                             to: day).day ?? 0
        switch offset {
        case 0...4:
            return Target(weekStep: 0, dayIndex: offset)
        case 5...7:
            // Friday evening and the weekend: `teachingDay` has already rolled to a Monday,
            // so this is the Monday of the next week, not a sixth day of this one.
            return Target(weekStep: 1, dayIndex: offset - 7)
        default:
            // The week on screen isn't the one today falls in — the student has paged away.
            // Monday of whatever they're looking at is the only sensible answer.
            return Target(weekStep: 0, dayIndex: 0)
        }
    }

    /// The Mon–Fri day being shown: today, tomorrow after the rollover hour, and the next
    /// Monday if that lands on a Saturday or Sunday.
    private static func teachingDay(from now: Date, calendar: Calendar) -> Date {
        let today = calendar.startOfDay(for: now)
        let hour = calendar.component(.hour, from: now)
        var day = hour >= rolloverHour
            ? (calendar.date(byAdding: .day, value: 1, to: today) ?? today)
            : today
        while isWeekend(day, calendar: calendar) {
            day = calendar.date(byAdding: .day, value: 1, to: day) ?? day
        }
        return day
    }

    private static func isWeekend(_ day: Date, calendar: Calendar) -> Bool {
        let weekday = calendar.component(.weekday, from: day)
        return weekday == 1 || weekday == 7      // Sunday, Saturday
    }
}
