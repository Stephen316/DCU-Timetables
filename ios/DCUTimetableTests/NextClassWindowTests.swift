import Foundation
import Testing
@testable import DCUTimetable

struct NextClassWindowTests {

    /// 2026-09-23 is a Wednesday; every time below is on it.
    private static func at(_ hour: Int, _ minute: Int = 0) -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 9
        components.day = 23
        components.hour = hour
        components.minute = minute
        return Calendar.current.date(from: components)!
    }

    private static let twoHour = WidgetClass(id: "lecture", title: "Computer Systems",
                                             code: "CA106", room: "HG20",
                                             start: at(9), end: at(11))

    @Test func theWindowOpensHalfTheClassLengthBeforeItStarts() {
        let window = NextClassWindow.window(for: Self.twoHour)
        #expect(window.lowerBound == Self.at(8))
    }

    @Test func theWindowClosesWhenTheClassIsHalfOver() {
        let window = NextClassWindow.window(for: Self.twoHour)
        #expect(window.upperBound == Self.at(10))
    }

    @Test func nothingIsHighlightedBeforeTheWindowOpens() {
        #expect(NextClassWindow.highlighted(in: [Self.twoHour], at: Self.at(7, 59)) == nil)
    }

    @Test func theClassIsHighlightedFromTheMomentTheWindowOpens() {
        #expect(NextClassWindow.highlighted(in: [Self.twoHour], at: Self.at(8))?.id == "lecture")
        #expect(NextClassWindow.highlighted(in: [Self.twoHour], at: Self.at(9, 30))?.id == "lecture")
    }

    /// Half-open at the top: at exactly half way the class stops being the one to head for.
    @Test func nothingIsHighlightedOnceTheClassIsHalfOver() {
        #expect(NextClassWindow.highlighted(in: [Self.twoHour], at: Self.at(10)) == nil)
        #expect(NextClassWindow.highlighted(in: [Self.twoHour], at: Self.at(10, 30)) == nil)
    }

    /// The reason the window closes early: the student is in the room and the next thing
    /// worth pointing at is where they go afterwards.
    @Test func theHighlightMovesToTheNextClassWhileTheCurrentOneIsStillRunning() {
        let lab = WidgetClass(id: "lab", title: "Lab", code: "CA106", room: "L101",
                              start: Self.at(10), end: Self.at(11))
        let classes = [Self.twoHour, lab]

        // 09:10 — only the lecture's window is open.
        #expect(NextClassWindow.highlighted(in: classes, at: Self.at(9, 10))?.id == "lecture")
        // 09:45 — both are open, and the lab is the one still to walk to.
        #expect(NextClassWindow.highlighted(in: classes, at: Self.at(9, 45))?.id == "lab")
    }

    /// Nearest start, not earliest start: order in the array must not decide it.
    @Test func overlappingWindowsAreResolvedByWhichStartIsNearest() {
        let lab = WidgetClass(id: "lab", title: "Lab", code: "CA106", room: "L101",
                              start: Self.at(10), end: Self.at(11))
        #expect(NextClassWindow.highlighted(in: [Self.twoHour, lab], at: Self.at(9, 45))?.id
                == NextClassWindow.highlighted(in: [lab, Self.twoHour], at: Self.at(9, 45))?.id)
    }

    /// A malformed event with no duration would otherwise have a zero-width window and
    /// could never be highlighted at all.
    @Test func aZeroLengthClassStillGetsAWindow() {
        let broken = WidgetClass(id: "broken", title: "?", code: "?", room: "",
                                 start: Self.at(12), end: Self.at(12))
        #expect(NextClassWindow.highlighted(in: [broken], at: Self.at(12))?.id == "broken")
        #expect(NextClassWindow.highlighted(in: [broken], at: Self.at(11, 57))?.id == "broken")
    }

    @Test func nothingIsHighlightedOnADayWithNoClasses() {
        #expect(NextClassWindow.highlighted(in: [], at: Self.at(9)) == nil)
    }

    // MARK: - Timeline dates

    /// Each edge the picture changes at needs an entry, or the widget shows the previous
    /// one until the system happens to refresh.
    @Test func everyWindowEdgeAndEndTimeBecomesARefreshDate() {
        let dates = NextClassWindow.refreshDates(for: [Self.twoHour], after: Self.at(7))
        #expect(dates.contains(Self.at(8)))   // window opens
        #expect(dates.contains(Self.at(10)))  // window closes
        #expect(dates.contains(Self.at(11)))  // class ends
    }

    /// An entry dated in the past is shown at once and swallows the rest of the timeline.
    @Test func refreshDatesAlreadyPastAreDropped() {
        let dates = NextClassWindow.refreshDates(for: [Self.twoHour], after: Self.at(10, 30))
        #expect(dates.contains(Self.at(8)) == false)
        #expect(dates.contains(Self.at(10)) == false)
        #expect(dates.first == Self.at(11))
    }

    /// What rolls the widget over to tomorrow when the app has not been opened.
    @Test func theFollowingMidnightIsAlwaysARefreshDate() {
        let midnight = Calendar.current.date(byAdding: .day, value: 1,
                                             to: Calendar.current.startOfDay(for: Self.at(9)))!
        #expect(NextClassWindow.refreshDates(for: [], after: Self.at(9)) == [midnight])
    }

    @Test func refreshDatesAreSortedAndDeduplicated() {
        let back = WidgetClass(id: "back", title: "Back to back", code: "CA107", room: "L101",
                               start: Self.at(11), end: Self.at(12))
        let dates = NextClassWindow.refreshDates(for: [Self.twoHour, back], after: Self.at(7))
        #expect(dates == dates.sorted())
        #expect(Set(dates).count == dates.count)
        // The lecture's end and the next class's start are the same instant, once.
        #expect(dates.filter { $0 == Self.at(11) }.count == 1)
    }
}
