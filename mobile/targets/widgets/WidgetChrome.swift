import SwiftUI
import UIKit
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

/// The app's canvas, rule and accent (`src/ui/theme.ts`), so a widget reads as part of
/// the app rather than as the system's grey tile with the system's blue in it.
///
/// Text keeps the hierarchical `.primary` / `.secondary` / `.tertiary` styles, set against
/// `ink`: in the tinted and clear home-screen modes the system recolours those levels
/// itself, where a fixed hex per level would flatten into one.
enum WidgetPalette {
    static let canvas = dynamic(light: 0xEEE8D5, dark: 0x212129)
    static let ink = dynamic(light: 0x073642, dark: 0xECEDF3)
    static let separator = dynamic(light: 0xD3CBB7, dark: 0x40445A)
    static let accent = dynamic(light: 0x6C71C4, dark: 0xAFB8F2)

    private static func dynamic(light: Int, dark: Int) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((rgb >> 16) & 0xFF) / 255,
                           green: CGFloat((rgb >> 8) & 0xFF) / 255,
                           blue: CGFloat(rgb & 0xFF) / 255,
                           alpha: 1)
        })
    }
}

/// The hairline under the header and between rows.
struct WidgetDivider: View {
    var body: some View {
        Rectangle()
            .fill(WidgetPalette.separator)
            .frame(height: 0.5)
    }
}

/// The line across the top of both widgets: what this is, and the day it describes.
struct WidgetHeader: View {
    let title: String
    let detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)
            if let detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 5)
        .overlay(alignment: .bottom) { WidgetDivider() }
    }
}

/// A stack of rows with a hairline between each pair. `isSeparated` lets a row that draws
/// its own outline go without the rule beside it, which would otherwise double its edge.
struct WidgetRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var isSeparated: (Item, Item) -> Bool = { _, _ in true }
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0, isSeparated(items[index - 1], item) {
                    WidgetDivider()
                }
                row(item)
            }
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

/// "+2 more" at the foot of a small widget, ruled off from the one item above it and
/// without the list's leading gutter.
struct WidgetOverflowInline: View {
    let count: Int
    var suffix: String? = nil

    var body: some View {
        if count > 0 {
            Text(["+\(count) more", suffix].compactMap { $0 }.joined(separator: " "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
                .overlay(alignment: .top) { WidgetDivider() }
        }
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
