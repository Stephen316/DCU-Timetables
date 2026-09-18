import Foundation

/// A stretch of a day with nothing timetabled in it.
public struct DayGap: Identifiable, Equatable, Sendable {
    public let start: Date
    public let end: Date

    public var id: Date { start }

    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }

    public var minutes: Int {
        Int((end.timeIntervalSince(start) / 60).rounded())
    }

    /// One row however long the gap is — five free hours read as "5 hours free", not as
    /// five empty rows the student has to scroll past to find their next class.
    public var label: String { DaySchedule.freeLabel(minutes: minutes) }
}

/// One line of the day view: a class, or the empty stretch before the next one.
public enum DaySlot: Identifiable, Equatable, Sendable {
    case session(TimetableEvent)
    case gap(DayGap)

    public var id: String {
        switch self {
        case .session(let event): return event.id
        case .gap(let gap): return "gap-\(gap.start.timeIntervalSince1970)"
        }
    }
}

public enum DaySchedule {
    /// Below this, the space between two classes is the walk between rooms, not free time.
    /// A row saying "5 min free" would be noise on every back-to-back pair.
    public static let shortestGap: TimeInterval = 15 * 60

    /// Classes in order with the gaps between them filled in.
    ///
    /// Gaps are measured from the latest end time seen so far, not from the previous class's
    /// end: two overlapping lectures would otherwise appear to leave a gap that runs
    /// backwards. Nothing is added before the first class or after the last — the day view
    /// describes the time between commitments, not the whole 24 hours.
    public static func slots(for events: [TimetableEvent]) -> [DaySlot] {
        let ordered = events.sorted { $0.start < $1.start }
        var slots: [DaySlot] = []
        var covered: Date?

        for event in ordered {
            if let covered, event.start.timeIntervalSince(covered) >= shortestGap {
                slots.append(.gap(DayGap(start: covered, end: event.start)))
            }
            slots.append(.session(event))
            covered = max(covered ?? event.end, event.end)
        }
        return slots
    }

    /// "45 min free", "1 hour free", "2 hr 30 min free" — shared by a single gap and by the
    /// day's running total, so the two can't be worded differently.
    public static func freeLabel(minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        switch (hours, remainder) {
        case (0, let mins):
            return "\(mins) min free"
        case (let hrs, 0):
            return hrs == 1 ? "1 hour free" : "\(hrs) hours free"
        default:
            return "\(hours) hr \(remainder) min free"
        }
    }

    /// Total free time between the first and last class, for the day's header.
    public static func freeMinutes(in slots: [DaySlot]) -> Int {
        slots.reduce(0) { total, slot in
            guard case .gap(let gap) = slot else { return total }
            return total + gap.minutes
        }
    }
}
