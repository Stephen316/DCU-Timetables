import Foundation

/// A pair of events that overlap in time.
public struct Clash: Equatable, Sendable {
    public let a: TimetableEvent
    public let b: TimetableEvent
    public init(a: TimetableEvent, b: TimetableEvent) {
        self.a = a
        self.b = b
    }
}

/// Pure clash detection. Meaningful only *after* events are filtered to the student's
/// chosen groups — a raw programme timetable is the superset of every stream and would
/// otherwise clash with itself.
public enum ClashDetector {

    /// All overlapping pairs among `events`.
    public static func clashes(in events: [TimetableEvent]) -> [Clash] {
        let sorted = events.sorted { $0.start < $1.start }
        var result: [Clash] = []
        for i in sorted.indices {
            let a = sorted[i]
            var j = sorted.index(after: i)
            while j < sorted.endIndex {
                let b = sorted[j]
                if b.start >= a.end { break }   // sorted by start ⇒ nothing later overlaps a
                if overlaps(a, b) { result.append(Clash(a: a, b: b)) }
                j = sorted.index(after: j)
            }
        }
        return result
    }

    /// The set of event ids involved in any clash (handy for highlighting).
    public static func clashingEventIDs(in events: [TimetableEvent]) -> Set<String> {
        var ids = Set<String>()
        for clash in clashes(in: events) {
            ids.insert(clash.a.id)
            ids.insert(clash.b.id)
        }
        return ids
    }

    static func overlaps(_ a: TimetableEvent, _ b: TimetableEvent) -> Bool {
        a.start < b.end && b.start < a.end
    }
}
