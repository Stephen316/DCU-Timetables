import AppKit
import UserNotifications

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: WebWindowController?
    private let alerts = AlertBridge()

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.make()
        UNUserNotificationCenter.current().delegate = alerts
        let window = WebWindowController(address: AppAddress.current, alerts: alerts)
        alerts.window = window
        self.window = window
        window.showWindow(nil)
        NSApp.activate()
    }

    /// Closing the window keeps the app running, as Calendar does, so alerts still arrive and
    /// clicking the Dock icon brings the timetable back as it was.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window?.showWindow(nil) }
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    // MARK: - Menu actions

    @objc func reloadApp(_ sender: Any?) {
        window?.reload()
    }

    @objc func zoomIn(_ sender: Any?) {
        window?.zoom(by: 0.1)
    }

    @objc func zoomOut(_ sender: Any?) {
        window?.zoom(by: -0.1)
    }

    @objc func actualSize(_ sender: Any?) {
        window?.resetZoom()
    }

    @objc func showMainWindow(_ sender: Any?) {
        window?.showWindow(nil)
    }

    @objc func openSupport(_ sender: Any?) {
        NSWorkspace.shared.open(AppAddress.support)
    }
}

/// Where the app is loaded from. The live web build by default, so the Mac app is always the
/// version on GitHub Pages; `-AppURL http://localhost:8081` on the command line (or
/// `defaults write com.stephenh.dcutimetable.mac AppURL …`) points it at a dev server.
enum AppAddress {
    static let live = URL(string: "https://stephen316.github.io/DCU-Timetables/app/")!
    static let support = URL(string: "https://stephen316.github.io/DCU-Timetables/support.html")!

    static var current: URL {
        UserDefaults.standard.string(forKey: "AppURL").flatMap(URL.init(string:)) ?? live
    }
}
