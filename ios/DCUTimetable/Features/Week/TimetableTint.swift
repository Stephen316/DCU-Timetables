import SwiftUI
import UIKit

/// The colours that carry meaning in the timetable, defined once.
///
/// SwiftUI's `.yellow` and `.orange` are tuned for dark backgrounds — on a white `List` row
/// yellow text and a yellow border are close to invisible, and the border here is carrying
/// information, not decoration. Each tint is therefore a darker shade in light mode and a
/// lighter one in dark mode, so contrast holds either way.
enum TimetableTint {
    /// Something to hand in today.
    static let due = dynamic(light: 0xB45309, dark: 0xFBBF24)
    /// A quiz or exam sat in that class.
    static let test = dynamic(light: 0x1D4ED8, dark: 0x60A5FA)
    /// Reported cancelled.
    static let off = dynamic(light: 0xC2410C, dark: 0xFB923C)
    /// Enough people have vouched for a deadline.
    static let confirmed = dynamic(light: 0x047857, dark: 0x34D399)

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
    static let modules: [Color] = [.blue, .green, .purple, .teal, .indigo, .pink, .brown]

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
