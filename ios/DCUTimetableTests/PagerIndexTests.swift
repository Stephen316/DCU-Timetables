import Foundation
import Testing
@testable import DCUTimetable

struct PagerIndexTests {

    private let weeks = 52

    // MARK: - Clamped: the week pager

    /// The bug this closes: swiping back from week 1 landed the student in week 52, which
    /// reads as the app losing its place rather than as reaching the start of the year.
    @Test func week1HasNothingBeforeIt() {
        #expect(PagerIndex.resolve(-1, count: weeks, bounds: .clamped) == nil)
        #expect(PagerIndex.step(from: 0, by: -1, count: weeks, bounds: .clamped) == 0)
        #expect(!PagerIndex.canStep(from: 0, by: -1, count: weeks, bounds: .clamped))
    }

    @Test func theLastWeekHasNothingAfterIt() {
        #expect(PagerIndex.resolve(weeks, count: weeks, bounds: .clamped) == nil)
        #expect(PagerIndex.step(from: 51, by: 1, count: weeks, bounds: .clamped) == 51)
        #expect(!PagerIndex.canStep(from: 51, by: 1, count: weeks, bounds: .clamped))
    }

    @Test func stepsNormallyInTheMiddle() {
        #expect(PagerIndex.step(from: 10, by: 1, count: weeks, bounds: .clamped) == 11)
        #expect(PagerIndex.step(from: 10, by: -1, count: weeks, bounds: .clamped) == 9)
        #expect(PagerIndex.canStep(from: 0, by: 1, count: weeks, bounds: .clamped))
        #expect(PagerIndex.canStep(from: 51, by: -1, count: weeks, bounds: .clamped))
        #expect(PagerIndex.resolve(0, count: weeks, bounds: .clamped) == 0)
        #expect(PagerIndex.resolve(51, count: weeks, bounds: .clamped) == 51)
    }

    /// A jump larger than one page still lands inside the year rather than overshooting.
    @Test func aBigStepStopsAtTheEdge() {
        #expect(PagerIndex.step(from: 3, by: -10, count: weeks, bounds: .clamped) == 0)
        #expect(PagerIndex.step(from: 48, by: 10, count: weeks, bounds: .clamped) == 51)
    }

    // MARK: - Wrapping: the day pager

    /// Days keep cycling inside their week — that one is not a teleport, it's five pages.
    @Test func daysStillWrapWithinTheWeek() {
        #expect(PagerIndex.resolve(-1, count: 5, bounds: .wrapping) == 4)   // Mon → Fri
        #expect(PagerIndex.resolve(5, count: 5, bounds: .wrapping) == 0)    // Fri → Mon
        #expect(PagerIndex.step(from: 0, by: -1, count: 5, bounds: .wrapping) == 4)
        #expect(PagerIndex.step(from: 4, by: 1, count: 5, bounds: .wrapping) == 0)
        #expect(PagerIndex.canStep(from: 0, by: -1, count: 5, bounds: .wrapping))
    }

    // MARK: - Degenerate inputs

    @Test func anEmptyPagerAsksForNothing() {
        for bounds in [PagerBounds.clamped, .wrapping] {
            #expect(PagerIndex.resolve(0, count: 0, bounds: bounds) == nil)
            #expect(PagerIndex.step(from: 0, by: 1, count: 0, bounds: bounds) == 0)
            #expect(!PagerIndex.canStep(from: 0, by: 1, count: 0, bounds: bounds))
        }
    }

    /// One page: nowhere to go either way, and wrapping must not spin on itself.
    @Test func aSinglePageGoesNowhere() {
        for bounds in [PagerBounds.clamped, .wrapping] {
            #expect(!PagerIndex.canStep(from: 0, by: 1, count: 1, bounds: bounds))
            #expect(!PagerIndex.canStep(from: 0, by: -1, count: 1, bounds: bounds))
        }
    }
}
