import Foundation

/// What a pager does when a swipe would run off the end of its pages.
public enum PagerBounds: Sendable {
    /// Cycles. The day pager does this: Friday → Monday is a move within one week, and the
    /// week either side is still the week you were looking at.
    case wrapping
    /// Stops. The week pager does this: week 1 is the start of the academic year, and
    /// there is nothing before it to scroll to.
    case clamped
}

/// Index arithmetic for `WrappingPager`, kept out of the view so the edges can be tested
/// without a gesture.
public enum PagerIndex {
    /// The page to show at `value`, or `nil` when there is no such page.
    ///
    /// A `nil` is what stops week 1 showing week 52 to its left: the pager draws blank
    /// there instead of the far end of the year.
    public static func resolve(_ value: Int, count: Int, bounds: PagerBounds) -> Int? {
        guard count > 0 else { return nil }
        switch bounds {
        case .wrapping:
            return ((value % count) + count) % count
        case .clamped:
            return (0..<count).contains(value) ? value : nil
        }
    }

    /// Where a step of `delta` lands. A clamped pager stays where it is rather than
    /// jumping to the other end of the year.
    public static func step(from index: Int, by delta: Int,
                            count: Int, bounds: PagerBounds) -> Int {
        guard count > 0 else { return 0 }
        switch bounds {
        case .wrapping:
            return resolve(index + delta, count: count, bounds: .wrapping) ?? 0
        case .clamped:
            return min(max(index + delta, 0), count - 1)
        }
    }

    /// Whether a step would actually move. Drives the chevrons' enabled state, so a button
    /// that does nothing looks like it does nothing.
    public static func canStep(from index: Int, by delta: Int,
                               count: Int, bounds: PagerBounds) -> Bool {
        guard count > 0 else { return false }
        return step(from: index, by: delta, count: count, bounds: bounds) != index
    }
}
