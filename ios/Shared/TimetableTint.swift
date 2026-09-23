import SwiftUI
import UIKit

/// The colours that carry meaning in the timetable, defined once.
///
/// Compiled into the widget extension as well as the app, which is why it sits in `Shared`
/// and is `public`. A widget drawing a cancelled class in a second orange would teach the
/// student that the two oranges mean different things.
///
/// SwiftUI's `.yellow` and `.orange` are tuned for dark backgrounds — on a white `List` row
/// yellow text and a yellow border are close to invisible, and the border here is carrying
/// information, not decoration. Each tint is therefore a darker shade in light mode and a
/// lighter one in dark mode, so contrast holds either way. Every light shade clears
/// 4.5:1 on the app's grey canvas (`Theme.canvas`), not just on white.
public enum TimetableTint {
    /// Something to hand in today.
    public static let due = dynamic(light: 0xA04A06, dark: 0xFBBF24)
    /// A quiz or exam sat in that class.
    public static let test = dynamic(light: 0x1D4ED8, dark: 0x60A5FA)
    /// Reported cancelled.
    public static let off = dynamic(light: 0xB43C0A, dark: 0xFB923C)
    /// Enough people have vouched for a deadline.
    public static let confirmed = dynamic(light: 0x047857, dark: 0x34D399)

    /// `off` as a **fill** behind white text, in either theme.
    ///
    /// The tints above flip lighter in dark mode so they stay legible as *foreground* on a
    /// dark background. A filled button inverts that relationship: the colour becomes the
    /// background, and white on the light shade lands near 2:1. A filled control is its own
    /// surface rather than part of the page, so it keeps the dark shade throughout, where
    /// white sits at about 4.9:1.
    public static let offFill = Color(uiColor: UIColor(rgb: 0xC2410C))

    /// Module colours for the calendar blocks: full-strength hues, one per module.
    ///
    /// These are decoration, not meaning — which module is which, at a glance, on a grid
    /// where every block is two words of 10pt text. Muting them (an earlier pass did) makes
    /// the week read as one grey mass and throws away the fastest thing about the grid.
    ///
    /// The tints above *do* carry meaning, and blue appears in both sets. They stay apart by
    /// role rather than by hue: a module is a 0.18-opacity wash with a bar down its left
    /// edge, while a highlight is a stroked border **and** a symbol in the corner. The
    /// symbol is what settles it — a colour alone was never carrying that load.
    public static let modules: [Color] = [.blue, .green, .purple, .teal, .indigo, .pink, .brown]

    private static func dynamic(light: Int, dark: Int) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(rgb: Int) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255,
                  green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255,
                  alpha: 1)
    }
}
