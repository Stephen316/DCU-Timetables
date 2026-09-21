import SwiftUI

/// The one place a highlight becomes a colour, so the day list and the calendar can never
/// disagree about what yellow means.
extension ClassHighlight {
    var tint: Color {
        switch self {
        case .cancelled: return TimetableTint.off
        // Same orange: a moved class is as much "don't go where you were going" as a
        // cancelled one, and a third colour would only add a thing to learn.
        case .moved: return TimetableTint.off
        case .test: return TimetableTint.test
        case .assignment: return TimetableTint.due
        }
    }

    var symbol: String {
        switch self {
        case .cancelled: return "exclamationmark.circle.fill"
        case .moved: return "arrow.turn.up.right"
        case .test: return "pencil.and.list.clipboard"
        case .assignment: return "doc.text"
        }
    }
}
