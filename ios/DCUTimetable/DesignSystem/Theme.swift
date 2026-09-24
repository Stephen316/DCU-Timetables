import SwiftUI

/// The app's design tokens: colour, space, shape and type, defined once.
///
/// The palette is deliberately monochrome — five slates of one cool blue-grey, and an
/// accent lifted from the same hue. Colour that isn't slate is news: orange for a
/// cancellation, amber for something due, blue for a test, green for a confirmed date
/// (`TimetableTint`). Keeping everything else grey is what lets those four be seen at a
/// glance on a phone held at arm's length on the way to a lecture.
///
/// Every colour lives in the asset catalog with light, dark and increased-contrast
/// variants, so the system picks the right one and nothing here branches on the scheme.
enum Theme {
    // MARK: Colour

    /// Behind everything: the screen itself. Dark #212129.
    static let canvas = Color("Canvas")
    /// A grouped list's rows. Dark #323949.
    static let surface = Color("Surface")
    /// One step up from a surface — sheets, a pressed row, a secondary button. Dark #3D3E51.
    static let raised = Color("Raised")
    /// Hairlines between rows and on the week grid. Dark #40445A.
    static let separator = Color("Separator")
    /// The line down the day view. Dark #4C5265.
    static let rail = Color("Rail")

    static let ink = Color("Ink")
    static let inkSecondary = Color("InkSecondary")
    /// Only on `canvas` or `surface`: at 3.3:1 on `raised` it is too faint for text there.
    static let inkTertiary = Color("InkTertiary")

    /// The asset catalog's `AccentColor`, so system controls pick it up without being told.
    static let accent = Color.accentColor
    /// Text on an accent fill.
    static let onAccent = Color("OnAccent")

    // MARK: Space

    /// A 4-point scale. Views take their padding from here rather than inventing numbers,
    /// so two screens that look alike are alike.
    enum Space {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    // MARK: Shape

    /// A radius per job, not one radius on everything: a block on the week grid has to stay
    /// a rectangle at 26pt tall, a button is a thing your thumb aims at, and a card is a
    /// panel of rows the size of the screen's width.
    enum Radius {
        static let block: CGFloat = 4
        static let control: CGFloat = 8
        static let card: CGFloat = 16
    }

    /// A button standing on its own in a list: the list's own side margins, none above or
    /// below, so it lines up with the rows but isn't one.
    static let standaloneRowInsets = EdgeInsets(top: 0, leading: Space.l, bottom: 0, trailing: Space.l)

    enum Size {
        /// The HIG's minimum hit area. Visible chrome may be smaller; the tappable frame isn't.
        static let minTarget: CGFloat = 44
        static let railLine: CGFloat = 2
    }
}

// MARK: - Type

/// All type is a system text style, so all of it follows Dynamic Type. The voice comes from
/// SF Pro's width axis, not from a second family: the day's name is set expanded, the clock
/// times condensed and tabular so they stack into a column.
extension Font {
    /// The weekday heading the day view. The one loud piece of type in the app.
    static let dayName = Font.largeTitle.weight(.bold).width(.expanded)
    /// A class's start time on the rail.
    static let railStart = Font.title3.weight(.semibold).width(.condensed).monospacedDigit()
    /// Its end time, under the start.
    static let railEnd = Font.footnote.width(.condensed).monospacedDigit()
    /// A page's own subject — the module name at the top of a class's page.
    static let pageTitle = Font.title2.weight(.semibold)
    /// Small status lines: "Reported cancelled", "Starts in 20 min".
    static let status = Font.caption.weight(.semibold)
}

// MARK: - Screens and lists

private struct AdaptiveLargeTitle: ViewModifier {
    @Environment(\.dynamicTypeSize) private var typeSize

    func body(content: Content) -> some View {
        content.navigationBarTitleDisplayMode(typeSize.isAccessibilitySize ? .inline : .large)
    }
}

/// Indents a row's second line under its first line's text, past the leading symbol —
/// except once the row has stacked (see `AdaptiveStack`), when the symbol sits on a line of
/// its own and an indent would only waste width.
struct HangingIndent: ViewModifier {
    var width: CGFloat = Theme.Space.xxl + Theme.Space.xxs
    @Environment(\.dynamicTypeSize) private var typeSize

    func body(content: Content) -> some View {
        content.padding(.leading, typeSize.isAccessibilitySize ? 0 : width)
    }
}

extension View {
    /// A grouped `List` on the app's canvas rather than the system grey.
    ///
    /// Rows still need `themedRows()` — a list's row background is a row trait, and there is
    /// no list-wide setting for it.
    func themedList() -> some View {
        scrollContentBackground(.hidden)
            .background(Theme.canvas)
    }

    /// Rows on the slate surface with slate hairlines. Apply to a `Section` or `ForEach`;
    /// the trait reaches every row inside.
    func themedRows() -> some View {
        listRowBackground(Theme.surface)
            .listRowSeparatorTint(Theme.separator)
    }

    /// A large navigation title that becomes an inline one at the accessibility text sizes.
    ///
    /// A large title doesn't wrap: at AX5 "DCU Timetable" is cut to "DCU Timeta…". The
    /// inline title has room for it, and the screen's content — which does wrap — carries
    /// the rest.
    func adaptiveLargeTitle() -> some View {
        modifier(AdaptiveLargeTitle())
    }

    /// A row that sits on the canvas itself, with no surface behind it — an introduction,
    /// or a button that stands on its own rather than inside a group.
    func bareRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}
