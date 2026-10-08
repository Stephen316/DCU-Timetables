#if DEBUG
import AppKit
import WebKit

/// Debug builds only: checking the window without Screen Recording permission. Launched with
/// `-DebugSnapshot /path/out.png` (and optionally `-DebugScript '<js>'`), the app waits for
/// the page to settle, runs the script, and writes the page as a PNG beside a `.txt` holding
/// the script's result and the window's colours.
@MainActor
enum DebugSnapshot {
    private static var taken = false

    static func pageLoaded(_ webView: WKWebView, in window: NSWindow?) {
        guard !taken, let path = UserDefaults.standard.string(forKey: "DebugSnapshot") else { return }
        taken = true
        let script = UserDefaults.standard.string(forKey: "DebugScript")
        Task {
            try? await Task.sleep(for: .seconds(3))
            var result = "-"
            if let script {
                let value = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
                result = String(describing: value ?? "nil")
                try? await Task.sleep(for: .seconds(1))
            }
            let image = try? await webView.takeSnapshot(configuration: nil)
            if let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: path))
            }
            let report = """
                url: \(webView.url?.absoluteString ?? "nil")
                window: \(window?.frame.debugDescription ?? "nil")
                background: \(window?.backgroundColor.description ?? "nil")
                appearance: \(window?.appearance?.name.rawValue ?? "system")
                themeColor: \(webView.themeColor?.description ?? "nil")
                script: \(result)
                """
            try? report.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
        }
    }
}
#endif
