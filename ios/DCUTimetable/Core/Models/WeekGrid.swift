import Foundation

/// Calendar-grid placement for one day's classes.
///
/// Classes that overlap in time can't be drawn on top of each other, so overlapping runs
/// are split into side-by-side columns (the standard calendar layout). Pure and testable —
/// the view only turns these numbers into rectangles.
public enum WeekGrid {

    public struct Placed: Identifiable, Equatable, Sendable {
        public let event: TimetableEvent
        /// Which side-by-side column this class occupies (0-based).
        public let column: Int
        /// How many columns its overlapping cluster needs, i.e. the width divisor.
        public let columnCount: Int

        public var id: String { event.id }
    }

    /// Places a day's events into overlap columns, in start order.
    public static func place(_ events: [TimetableEvent]) -> [Placed] {
        let sorted = events.sorted {
            $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start
        }

        var result: [Placed] = []
        var cluster: [TimetableEvent] = []
        var clusterEnd: Date?

        func flushCluster() {
            guard !cluster.isEmpty else { return }
            var columnEnds: [Date] = []
            var assignments: [(TimetableEvent, Int)] = []
            for event in cluster {
                if let free = columnEnds.firstIndex(where: { $0 <= event.start }) {
                    columnEnds[free] = event.end
                    assignments.append((event, free))
                } else {
                    columnEnds.append(event.end)
                    assignments.append((event, columnEnds.count - 1))
                }
            }
            let width = columnEnds.count
            result += assignments.map {
                Placed(event: $0.0, column: $0.1, columnCount: width)
            }
            cluster = []
            clusterEnd = nil
        }

        for event in sorted {
            if let end = clusterEnd, event.start < end {
                cluster.append(event)
                clusterEnd = Swift.max(end, event.end)
            } else {
                flushCluster()
                cluster = [event]
                clusterEnd = event.end
            }
        }
        flushCluster()
        return result
    }
}
