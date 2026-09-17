import Foundation
import Testing
@testable import DCUTimetable

struct PagerDragStateTests {

    @Test func tapsPassThroughWhenNobodyIsSwiping() {
        #expect(!PagerDragState().isSuppressingTaps())
    }

    @Test func tapsAreBlockedDuringASwipe() {
        let state = PagerDragState()
        state.begin()
        #expect(state.isSuppressingTaps())
    }

    /// The bug this exists for: the finger lifting at the end of a swipe arrives as a tap
    /// on the row the swipe started on, just after the drag ends.
    @Test func tapsAreBlockedForAMomentAfterASwipe() {
        let state = PagerDragState()
        let end = Date()
        state.begin()
        state.end(at: end)

        #expect(state.isSuppressingTaps(at: end))
        #expect(state.isSuppressingTaps(at: end.addingTimeInterval(0.1)))
        // ...but a deliberate tap a moment later must still open the class.
        #expect(!state.isSuppressingTaps(at: end.addingTimeInterval(PagerDragState.tapBlackout)))
        #expect(!state.isSuppressingTaps(at: end.addingTimeInterval(1)))
    }

    /// A new swipe starting inside the blackout must block again, not inherit the old timer.
    @Test func aSecondSwipeBlocksAgain() {
        let state = PagerDragState()
        state.end(at: Date().addingTimeInterval(-10))
        #expect(!state.isSuppressingTaps())
        state.begin()
        #expect(state.isSuppressingTaps())
    }
}
