import SwiftUI

@main
struct DCUTimetableApp: App {
    @AppStorage(AppearanceSetting.storageKey) private var appearance: AppearanceSetting = .system

    var body: some Scene {
        WindowGroup {
            Group {
            #if DEBUG
            // `-previewScreen <name>` opens one screen on fixture data (see PreviewSupport).
            if let screen = PreviewScreen.requested {
                screen.view
            } else {
                RootView()
            }
            #else
            RootView()
            #endif
            }
            // Toggles and pickers too, not only buttons: a system-green switch would read as
            // "confirmed", which is what green means everywhere else in the app.
            .tint(Theme.accent)
            // `initial` so a saved choice is in force from launch, not only after a change.
            .onChange(of: appearance, initial: true) { _, setting in setting.apply() }
        }
    }
}
