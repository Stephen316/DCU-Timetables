import AppKit

/// The menu bar, built in code since the app has no nib. The Edit menu matters beyond looks:
/// a web view only gets ⌘C, ⌘V and ⌘A through menu items that send those selectors.
@MainActor
enum MainMenu {
    static func make() -> NSMenu {
        let name = "DCU Timetable"
        let bar = NSMenu()

        bar.addSubmenu(name, [
            item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"),
        ])

        bar.addSubmenu("File", [
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
        ])

        bar.addSubmenu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])

        bar.addSubmenu("View", [
            item("Reload", #selector(AppDelegate.reloadApp(_:)), "r"),
            .separator(),
            item("Actual Size", #selector(AppDelegate.actualSize(_:)), "0"),
            item("Zoom In", #selector(AppDelegate.zoomIn(_:)), "="),
            item("Zoom Out", #selector(AppDelegate.zoomOut(_:)), "-"),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])

        let window = bar.addSubmenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("DCU Timetable", #selector(AppDelegate.showMainWindow(_:)), "1"),
        ])
        NSApp.windowsMenu = window

        let help = bar.addSubmenu("Help", [
            item("DCU Timetable Help", #selector(AppDelegate.openSupport(_:))),
        ])
        NSApp.helpMenu = help

        return bar
    }

    private static func item(
        _ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        return item
    }
}

private extension NSMenu {
    @discardableResult
    func addSubmenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
        let menu = NSMenu(title: title)
        items.forEach(menu.addItem)
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        addItem(holder)
        return menu
    }
}
