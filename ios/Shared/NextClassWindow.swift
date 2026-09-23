import Foundation

/// When a class is *the* class — the one the widget picks out of the day.
///
/// The window opens half the class's length before it starts and closes once the class is
/// half over: a two-hour lecture at 09:00 is highlighted from 08:00 until 10:00. Both
/// edges are measured from the class's own length on purpose. A fixed lead time would
/// highlight a nine-hour lab the same distance out as a fifty-minute tutorial, and a fixed
/// trailing time would keep a tutorial highlighted long after the only useful thing about
/// it — where to be — stopped mattering.
///
/// Closing at the halfway mark is what lets the highlight move on its own: by the time a
/// class is half done, the next one's window has usually opened, and the widget starts
/// pointing at where the student is going rather than where they already are.
public enum NextClassWindow {
    /// Half-open: a class stops being highlighted at the instant it is half over, so two
    /// classes can never both claim the same instant by touching at an edge.
    public static func window(for item: WidgetClass) -> Range<Date> {
        item.start.addingTimeInterval(-item.halfLength) ..< item.start.addingTimeInterval(item.halfLength)
    }

    /// The class to highlight now, or nothing when no window is open.
    ///
    /// Nothing is deliberate. Outside every window there is no class the student needs to
    /// be moving towards, and inventing a highlight — the next one whenever it happens to
    /// be — would make the emphasis meaningless by never removing it. A widget that
    /// highlights something at all times is a widget that highlights nothing.
    ///
    /// Windows can overlap: a 09:00–11:00 lecture is highlighted until 10:00, and a
    /// 10:00–11:00 lab from 09:30. The class whose start is nearest wins, which at 09:45
    /// is the lab — the one still to walk to — and at 09:10 is the lecture. Ties go to
    /// whichever starts first, so the answer never depends on the array's order.
    public static func highlighted(in classes: [WidgetClass], at now: Date) -> WidgetClass? {
        classes
            .filter { window(for: $0).contains(now) }
            .min {
                let (a, b) = (distance($0, now), distance($1, now))
                return a == b ? $0.start < $1.start : a < b
            }
    }

    private static func distance(_ item: WidgetClass, _ now: Date) -> TimeInterval {
        abs(item.start.timeIntervalSince(now))
    }

    /// Every instant at which the day's display could change, so the timeline has an entry
    /// waiting at each one.
    ///
    /// WidgetKit does not redraw continuously — it renders the entries it was handed and
    /// nothing else. Without this the highlight would appear and disappear whenever the
    /// system happened to refresh, which is not when the class starts. Each window edge
    /// and each end time is a boundary; so is the following midnight, which is what rolls
    /// the widget over to tomorrow when the app has not been opened.
    ///
    /// Anything already past is dropped and the list is deduplicated, because a timeline
    /// entry dated in the past is shown immediately and would skip the rest.
    public static func refreshDates(for classes: [WidgetClass], after now: Date,
                                    calendar: Calendar = .current) -> [Date] {
        var dates: Set<Date> = []
        for item in classes {
            let window = window(for: item)
            dates.formUnion([window.lowerBound, window.upperBound, item.end])
        }
        if let midnight = calendar.date(byAdding: .day, value: 1,
                                        to: calendar.startOfDay(for: now)) {
            dates.insert(midnight)
        }
        return dates.filter { $0 > now }.sorted()
    }
}
