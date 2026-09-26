import SwiftUI
import WidgetKit

/// The pieces both widgets draw, so a row on the timetable and a row on the deadlines
/// widget line up rather than being two people's idea of a row.
enum WidgetChrome {
    /// The gutter every leading column is set in. A fixed width is what makes the times
    /// and the symbols form a column instead of a ragged edge — the rows are laid out
    /// independently and have no grid to align to.
    static let gutter: CGFloat = 44

    /// Rows are the height of two lines of text plus their padding, and the widget's own
    /// body inset is fixed. How many fit is therefore arithmetic, not taste, but the
    /// numbers below are the ones that survived being looked at: one short of what fits,
    /// so a row is never half-clipped at the bottom edge.
    static func rowLimit(for family: WidgetFamily) -> Int {
        switch family {
        case .systemSmall:  return 2
        case .systemMedium: return 3
        case .systemLarge:  return 7
        default:            return 3
        }
    }
}

/// The line across the top of both widgets: what this is, and the day it describes.
struct WidgetHeader: View {
    let title: String
    let detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
            if let detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

/// What a widget says when it has nothing to list.
///
/// Two different silences: the app has never written a snapshot (so the widget cannot
/// know anything), and the app has written one that happens to be empty. Saying "no
/// classes today" when the truth is "this widget has never been given any data" is the
/// one message that could actually make a student miss a lecture.
struct WidgetEmptyState: View {
    let symbol: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.tertiary)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// "+2 more", when the day does not fit.
struct WidgetOverflow: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("+\(count) more")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.leading, WidgetChrome.gutter)
        }
    }
}

extension Date {
    /// "09:00" or "9:00 AM", whichever the student's device uses. Widgets are read at a
    /// glance and the seconds are noise.
    var widgetTime: String {
        formatted(date: .omitted, time: .shortened)
    }
}
