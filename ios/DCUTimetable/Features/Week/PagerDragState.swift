import SwiftUI

/// Whether a swipe is in progress, shared from the pager down to the rows inside it.
///
/// A row inside a `List` doesn't cancel its press when the finger moves **horizontally** —
/// the list only claims vertical movement — so at the end of a swipe the finger lifting
/// reads as a tap on whatever the swipe started on. The pager marks the drag here and each
/// tappable row checks it before acting.
///
/// A class, not a `@State` value, on purpose: the flag changes on every drag frame, and a
/// value type in the environment would rebuild every page mid-swipe. Nothing observes it —
/// it's read once, at the moment a tap fires.
final class PagerDragState: @unchecked Sendable {
    private var isDragging = false
    private var endedAt: Date?

    /// How long after a swipe a tap is still treated as part of that swipe. Long enough to
    /// cover the gap between the finger lifting and the tap arriving, short enough that a
    /// deliberate second tap still lands.
    static let tapBlackout: TimeInterval = 0.35

    func begin() {
        isDragging = true
        endedAt = nil
    }

    func end(at now: Date = Date()) {
        isDragging = false
        endedAt = now
    }

    func isSuppressingTaps(at now: Date = Date()) -> Bool {
        if isDragging { return true }
        guard let endedAt else { return false }
        return now.timeIntervalSince(endedAt) < Self.tapBlackout
    }
}

private struct PagerDragStateKey: EnvironmentKey {
    static let defaultValue = PagerDragState()
}

extension EnvironmentValues {
    /// The enclosing pager's drag state. Defaults to one that never suppresses anything, so
    /// a row used outside a pager behaves normally.
    var pagerDrag: PagerDragState {
        get { self[PagerDragStateKey.self] }
        set { self[PagerDragStateKey.self] = newValue }
    }
}
