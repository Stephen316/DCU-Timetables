import SwiftUI

/// The one place a highlight becomes a colour, so the day list and the calendar can never
/// disagree about what yellow means.
extension ClassHighlight {
    var tint: Color {
        switch self {
        case .cancelled: return TimetableTint.off
        case .test: return TimetableTint.test
        case .assignment: return TimetableTint.due
        }
    }

    var symbol: String {
        switch self {
        case .cancelled: return "exclamationmark.circle.fill"
        case .test: return "pencil.and.list.clipboard"
        case .assignment: return "doc.text"
        }
    }
}
