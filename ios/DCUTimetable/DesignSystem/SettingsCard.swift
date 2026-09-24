import SwiftUI

// Settings as cards of rows: a line icon, a label, sometimes a value, and a chevron when the
// row opens something. Used where a screen is a list of places to go rather than a list of
// things — Account — so it reads as a menu, not as data.

/// A rounded panel of rows on the canvas. Rows are separated with `SettingsDivider`.
struct SettingsCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(Theme.surface)
            // Clipped, so a pressed row's highlight takes the card's corners.
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// What sits at a row's trailing edge.
enum SettingsAccessory {
    /// Opens another page or sheet.
    case chevron
    /// Acts where it is: copy, sign out, delete.
    case none
}

struct SettingsRow: View {
    let title: String
    let symbol: String
    var value: String? = nil
    var tint: Color = Theme.ink
    var accessory: SettingsAccessory = .chevron

    @ScaledMetric(relativeTo: .title3) private var iconWidth: CGFloat = 28

    var body: some View {
        HStack(spacing: Theme.Space.l) {
            // Capped: the icon only says what kind of row this is, and at AX5 an uncapped one
            // takes the width the label needs to avoid breaking mid-word.
            Image(systemName: symbol)
                .font(.title3.weight(.light))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .foregroundStyle(tint)
                .frame(width: SettingsMetrics.iconWidth(iconWidth))
                .accessibilityHidden(true)

            // The value moves under the label at the accessibility sizes rather than
            // squeezing it.
            AdaptiveStack(spacing: Theme.Space.xxs) {
                Text(title)
                    .foregroundStyle(tint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let value {
                    Text(value)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)

            if accessory == .chevron {
                Image(systemName: "chevron.right")
                    .font(.body.weight(.regular))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .foregroundStyle(Theme.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .font(.body)
        .padding(.horizontal, Theme.Space.l)
        .padding(.vertical, Theme.Space.l)
        .frame(maxWidth: .infinity, minHeight: Theme.Size.minTarget, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

enum SettingsMetrics {
    /// The scaled icon column, stopped where the icon itself stops growing.
    static func iconWidth(_ scaled: CGFloat) -> CGFloat { min(scaled, 36) }
}

/// A hairline starting at the rows' text, past the icon column.
struct SettingsDivider: View {
    @ScaledMetric(relativeTo: .title3) private var iconWidth: CGFloat = 28
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Rectangle()
            .fill(Theme.separator)
            .frame(height: 1 / displayScale)
            .padding(.leading, Theme.Space.l + SettingsMetrics.iconWidth(iconWidth) + Theme.Space.l)
            .padding(.trailing, Theme.Space.l)
    }
}
