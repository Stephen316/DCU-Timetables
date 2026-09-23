import SwiftUI
import UIKit

/// Light, dark, or whatever the phone is set to. A device preference rather than an account
/// one, so it survives signing out.
enum AppearanceSetting: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "appearance"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "Match iPhone"
        case .light:  return "Light"
        case .dark:   return "Dark"
        }
    }

    private var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: return .unspecified
        case .light:  return .light
        case .dark:   return .dark
        }
    }

    /// Set on the windows rather than through `preferredColorScheme`.
    ///
    /// `preferredColorScheme(nil)` doesn't reliably hand control back to the system once
    /// a scheme has been forced — choosing "Match iPhone" would leave the app stuck in
    /// whichever mode it was last in until a relaunch. A window's override reverts
    /// immediately, and it covers every sheet, alert and keyboard in that window too.
    @MainActor
    func apply() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = interfaceStyle
            }
        }
    }
}
