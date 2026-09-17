import Foundation

/// Which weekday the day view opens on.
///
/// Today, except that from 6pm the day is effectively over — nobody opening the app on a
/// Tuesday evening wants Tuesday's finished lectures, they're checking what's on tomorrow.
/// Anything landing on a weekend falls to Monday, which also covers Friday evening.
public enum DefaultDay {
    /// From this hour the next teaching day is shown instead of today.
    public static let rolloverHour = 18

    /// Mon–Fri index (0 = Monday) within the week starting `weekStart`, or Monday when the
    /// day being shown isn't in that week at all.
    public static func index(weekStart: Date, now: Date = Date(), calendar: Calendar = .current) -> Int {
        let hour = calendar.component(.hour, from: now)
        let today = calendar.startOfDay(for: now)
        let target = hour >= rolloverHour
            ? (calendar.date(byAdding: .day, value: 1, to: today) ?? today)
            : today

        let offset = calendar.dateComponents([.day],
                                             from: calendar.startOfDay(for: weekStart),
                                             to: target).day ?? 0
        return (0...4).contains(offset) ? offset : 0
    }
}
