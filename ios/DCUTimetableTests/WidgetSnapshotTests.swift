import Foundation
import Testing
@testable import DCUTimetable

struct WidgetSnapshotTests {

    private static func at(_ day: Int, _ hour: Int) -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 9
        components.day = day
        components.hour = hour
        return Calendar.current.date(from: components)!
    }

    private static func event(_ id: String, start: Date, end: Date,
                              locations: [String] = ["GLA.HG20"]) -> TimetableEvent {
        TimetableEvent(id: id, start: start, end: end, type: .onCampus,
                       locations: locations, moduleName: "Computer Systems", staff: [],
                       activity: ActivityCode("CA106[1]OC/L1/01"), weekLabels: [])
    }

    private static func deadline(_ id: String, due: Date,
                                 kind: DeadlineKind = .assignment) -> Deadline {
        Deadline(id: id, moduleKey: "CA106", title: "Lab \(id)", due: due, kind: kind,
                 submitterID: "someone")
    }

    private static let clear: (TimetableEvent) -> CancellationStatus = { _ in
        CancellationStatus(reportCount: 0)
    }

    // MARK: - Flattening

    @Test func aClassCarriesItsTimesTitleAndRoom() {
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11))],
            deadlines: [], status: Self.clear, now: Self.at(23, 8))
        let item = snapshot.classes.first
        #expect(item?.title == "Computer Systems")
        #expect(item?.code == "CA106")
        #expect(item?.start == Self.at(23, 9))
        #expect(item?.state == .scheduled)
    }

    /// Bare codes, not "Henry Grattan, Room 20" — a widget row is one line, and the
    /// building name is the part that truncates.
    @Test func theRoomIsTheBareCode() {
        let event = Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11))
        #expect(WidgetSnapshotPublisher.room(for: event) == "HG20")
    }

    @Test func aClassWithNoRoomCarriesAnEmptyOne() {
        let event = Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11), locations: [])
        #expect(WidgetSnapshotPublisher.room(for: event) == "")
    }

    @Test func aFlaggedClassIsMarkedCancelled() {
        let flagged: (TimetableEvent) -> CancellationStatus = { _ in
            CancellationStatus(reportCount: 4, onCount: 0)
        }
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11))],
            deadlines: [], status: flagged, now: Self.at(23, 8))
        #expect(snapshot.classes.first?.state == .cancelled)
    }

    /// Reports below the bar are the app's business, not the widget's: a class two people
    /// have doubts about is still a class to turn up to.
    @Test func reportsBelowTheThresholdLeaveTheClassScheduled() {
        let disputed: (TimetableEvent) -> CancellationStatus = { _ in
            CancellationStatus(reportCount: 2, onCount: 0)
        }
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11))],
            deadlines: [], status: disputed, now: Self.at(23, 8))
        #expect(snapshot.classes.first?.state == .scheduled)
    }

    @Test func classesAreWrittenInTimeOrder() {
        let late = Self.event("late", start: Self.at(23, 15), end: Self.at(23, 16))
        let early = Self.event("early", start: Self.at(23, 9), end: Self.at(23, 10))
        let snapshot = WidgetSnapshotPublisher.snapshot(events: [late, early], deadlines: [],
                                                        status: Self.clear, now: Self.at(23, 8))
        #expect(snapshot.classes.map(\.id) == ["early", "late"])
    }

    // MARK: - Deadlines

    /// The same horizon the app uses, so the widget can't list something the tab dropped.
    @Test func deadlinesBeforeTodayAreNotWritten() {
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [],
            deadlines: [Self.deadline("old", due: Self.at(20, 12)),
                        Self.deadline("soon", due: Self.at(25, 12))],
            status: Self.clear, now: Self.at(23, 8))
        #expect(snapshot.deadlines.map(\.id) == ["soon"])
    }

    /// Something due at 11am is still listed at 11:01 — the student is probably writing it.
    @Test func aDeadlineEarlierTodayIsStillListed() {
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [], deadlines: [Self.deadline("today", due: Self.at(23, 11))],
            status: Self.clear, now: Self.at(23, 14))
        #expect(snapshot.upcomingDeadlines(at: Self.at(23, 14)).map(\.id) == ["today"])
    }

    @Test func aTestSatInClassIsMarkedAsOne() {
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [], deadlines: [Self.deadline("quiz", due: Self.at(25, 12), kind: .quiz)],
            status: Self.clear, now: Self.at(23, 8))
        #expect(snapshot.deadlines.first?.isSatInClass == true)
        #expect(snapshot.deadlines.first?.symbol == DeadlineKind.quiz.symbol)
    }

    // MARK: - Reading a day back

    /// The snapshot holds the whole week so the widget can roll over midnight on its own,
    /// which only works if it can pick one day back out.
    @Test func onlyTheAskedForDayComesBack() {
        let snapshot = WidgetSnapshotPublisher.snapshot(
            events: [Self.event("wed", start: Self.at(23, 9), end: Self.at(23, 11)),
                     Self.event("thu", start: Self.at(24, 9), end: Self.at(24, 11))],
            deadlines: [], status: Self.clear, now: Self.at(23, 8))
        #expect(snapshot.classes(on: Self.at(24, 0)).map(\.id) == ["thu"])
        #expect(snapshot.classes(on: Self.at(26, 0)).isEmpty)
    }

    // MARK: - Round trip

    /// The file outlives a build and is read by a different process, so a snapshot that
    /// cannot survive being written and read is a widget that is permanently empty.
    @Test func aSnapshotSurvivesBeingEncodedAndDecoded() throws {
        let original = WidgetSnapshotPublisher.snapshot(
            events: [Self.event("a", start: Self.at(23, 9), end: Self.at(23, 11))],
            deadlines: [Self.deadline("d", due: Self.at(25, 12))],
            status: Self.clear, now: Self.at(23, 8))

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let restored = try decoder.decode(WidgetSnapshot.self,
                                          from: try encoder.encode(original))
        #expect(restored == original)
    }

    /// How both widgets tell "nothing is due" from "the app has never run".
    @Test func theEmptySnapshotIsDistinguishableFromAnEmptyDay() {
        #expect(WidgetSnapshot.empty.updatedAt == .distantPast)
        let written = WidgetSnapshotPublisher.snapshot(events: [], deadlines: [],
                                                       status: Self.clear, now: Self.at(23, 8))
        #expect(written.updatedAt != .distantPast)
    }

    // MARK: - Countdown wording

    /// Shared with the deadlines tab so the widget and the list can't word it differently.
    @Test func theCountdownWordingIsTheOneTheAppUses() {
        let now = Self.at(23, 9)
        #expect(DeadlineCountdown.text(to: Self.at(23, 17), from: now) == "today")
        #expect(DeadlineCountdown.text(to: Self.at(24, 9), from: now) == "tomorrow")
        #expect(DeadlineCountdown.text(to: Self.at(26, 9), from: now) == "in 3 days")
        #expect(DeadlineRules.countdown(to: Self.at(24, 9), from: now)
                == DeadlineCountdown.text(to: Self.at(24, 9), from: now))
    }
}
