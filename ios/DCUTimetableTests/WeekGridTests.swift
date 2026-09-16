import Foundation
import Testing
@testable import DCUTimetable

struct WeekGridTests {

    private func event(_ id: String, _ startHour: Double, _ endHour: Double) -> TimetableEvent {
        let base = Date(timeIntervalSince1970: 0)
        return TimetableEvent(
            id: id,
            start: base.addingTimeInterval(startHour * 3600),
            end: base.addingTimeInterval(endHour * 3600),
            type: .onCampus, locations: [], moduleName: nil, staff: [],
            activity: ActivityCode(""), weekLabels: []
        )
    }

    @Test func sequentialClassesEachTakeFullWidth() {
        let placed = WeekGrid.place([event("a", 9, 10), event("b", 10, 11), event("c", 13, 14)])
        #expect(placed.count == 3)
        #expect(placed.allSatisfy { $0.columnCount == 1 && $0.column == 0 })
    }

    @Test func overlappingClassesSplitIntoColumns() {
        let placed = WeekGrid.place([event("a", 9, 11), event("b", 10, 12)])
        #expect(placed.count == 2)
        #expect(placed.allSatisfy { $0.columnCount == 2 })
        #expect(Set(placed.map(\.column)) == [0, 1])
    }

    @Test func aClusterReusesAFreedColumn() {
        // a 9–11, b 10–12, c 11–13: c starts as a ends, so it reuses a's column,
        // but the whole run is one 2-wide cluster.
        let placed = WeekGrid.place([event("a", 9, 11), event("b", 10, 12), event("c", 11, 13)])
        #expect(placed.allSatisfy { $0.columnCount == 2 })
        let byID = Dictionary(uniqueKeysWithValues: placed.map { ($0.event.id, $0.column) })
        #expect(byID["a"] == 0)
        #expect(byID["b"] == 1)
        #expect(byID["c"] == 0)      // freed by a
    }

    @Test func separateClustersAreIndependent() {
        // morning pair overlaps; afternoon single should not be widened by it.
        let placed = WeekGrid.place([event("a", 9, 11), event("b", 10, 12), event("c", 15, 16)])
        let byID = Dictionary(uniqueKeysWithValues: placed.map { ($0.event.id, $0.columnCount) })
        #expect(byID["a"] == 2)
        #expect(byID["c"] == 1)
    }

    @Test func emptyDayPlacesNothing() {
        #expect(WeekGrid.place([]).isEmpty)
    }
}
