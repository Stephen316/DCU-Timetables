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
    /// Reported not on.
    static let off = dynamic(light: 0xC2410C, dark: 0xFB923C)
    /// Enough people have vouched for a deadline.
    static let confirmed = dynamic(light: 0x047857, dark: 0x34D399)

    /// Module colours for the calendar blocks. Deliberately muted and deliberately *not*
    /// amber, blue or orange: a module tinted blue sitting beside a blue "quiz today"
    /// border would read as if the colour meant something it doesn't.
    static let modules: [Color] = [
        dynamic(light: 0x4B5563, dark: 0x9CA3AF),   // slate
        dynamic(light: 0x5B6B5A, dark: 0xA3B3A2),   // sage
        dynamic(light: 0x6B5B6E, dark: 0xB7A5BA),   // mauve
        dynamic(light: 0x4C5A66, dark: 0x9BAAB8),   // steel
        dynamic(light: 0x6E5F4B, dark: 0xC0AC8E),   // clay
        dynamic(light: 0x585B72, dark: 0xA6A9C4),   // dusk
    ]

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
