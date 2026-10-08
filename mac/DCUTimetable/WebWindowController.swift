import AppKit
import Network
import WebKit

/// The one window: the student app's web build, filling it. The page is loaded live, so every
/// push to `mobile/` reaches the Mac with no new build of this app, and the web build's own
/// update check (`webUpdate.ts`) swaps in a newer one when the window comes back to the front.
@MainActor
final class WebWindowController: NSWindowController, NSWindowDelegate {
    private let address: URL
    private let webView: WKWebView
    private var themeObservation: NSKeyValueObservation?
    private let network = NWPathMonitor()
    private var showingOffline = false
    /// Whether the load under way is the cache-only retry, so its failure ends the retries.
    private var loadingFromCache = false

    private static let zoomKey = "PageZoom"

    init(address: URL, alerts: AlertBridge) {
        self.address = address

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "DCUTimetableMac/1.0"
        configuration.userContentController.addScriptMessageHandler(
            alerts, contentWorld: .page, name: AlertBridge.handlerName)
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        let zoom = UserDefaults.standard.double(forKey: Self.zoomKey)
        webView.pageZoom = zoom > 0 ? zoom : 1

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "DCU Timetable"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 380, height: 560)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.contentView = webView
        // Before the page paints, the canvas the app opens on.
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: 0x21 / 255, green: 0x21 / 255, blue: 0x29 / 255, alpha: 1)
                : NSColor(srgbRed: 0xEE / 255, green: 0xE8 / 255, blue: 0xD5 / 255, alpha: 1)
        }
        window.center()
        window.setFrameAutosaveName("Main")

        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // The app repaints `theme-color` from its own appearance setting, which can differ from
        // the Mac's; the title bar follows it so the window reads as one surface.
        themeObservation = webView.observe(\.themeColor, options: [.new]) { [weak self] webView, _ in
            MainActor.assumeIsolated { self?.adoptTheme(webView.themeColor) }
        }

        // Back online after an offline start: load the app rather than wait for a click.
        network.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                guard let self, self.showingOffline else { return }
                self.load()
            }
        }
        network.start(queue: .main)

        load()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: - Loading

    private func load(cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy) {
        showingOffline = false
        loadingFromCache = cachePolicy == .returnCacheDataDontLoad
        webView.load(URLRequest(url: address, cachePolicy: cachePolicy))
    }

    func reload() {
        if showingOffline || webView.url == nil { load() } else { webView.reload() }
    }

    /// Offline at launch: the copy WebKit cached last time, if it has one, then a plain page
    /// saying why there is nothing to show.
    private func loadFailed(_ error: Error) {
        let error = error as NSError
        guard error.domain == NSURLErrorDomain, error.code != NSURLErrorCancelled else { return }
        if !loadingFromCache {
            load(cachePolicy: .returnCacheDataDontLoad)
            return
        }
        showingOffline = true
        webView.loadHTMLString(OfflinePage.html(retrying: address), baseURL: nil)
    }

    // MARK: - Zoom

    func zoom(by step: Double) {
        setZoom(min(max(webView.pageZoom + step, 0.5), 2))
    }

    func resetZoom() {
        setZoom(1)
    }

    private func setZoom(_ value: Double) {
        webView.pageZoom = value
        UserDefaults.standard.set(value, forKey: Self.zoomKey)
    }

    // MARK: - Theme

    private func adoptTheme(_ color: NSColor?) {
        guard let window, let color = color?.usingColorSpace(.sRGB) else { return }
        window.backgroundColor = color
        let luminance = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
        window.appearance = NSAppearance(named: luminance < 0.5 ? .darkAqua : .aqua)
    }

    /// Runs script in the page; used to hand it a tapped alert.
    func evaluate(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}

// MARK: - Navigation

extension WebWindowController: WKNavigationDelegate, WKUIDelegate {
    /// The app stays in the window; anything else — the privacy policy, a Loop link, an email
    /// address — opens where the Mac would open it.
    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if isInsideApp(url) || url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" {
            return decisionHandler(.allow)
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    /// `window.open` and `target=_blank` — how the web build's `Linking.openURL` leaves.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        #if DEBUG
        DebugSnapshot.pageLoaded(webView, in: window)
        #endif
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }

    func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        if let window { alert.beginSheetModal(for: window) { _ in completionHandler() } } else { completionHandler() }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        if let window {
            alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
        } else {
            completionHandler(false)
        }
    }

    private func isInsideApp(_ url: URL) -> Bool {
        url.scheme == address.scheme && url.host == address.host && url.port == address.port
            && url.path.hasPrefix(address.path)
    }
}

/// Shown only when there's neither a network nor a cached copy: the first launch offline.
private enum OfflinePage {
    static func html(retrying address: URL) -> String {
        """
        <!doctype html><meta charset="utf-8"><meta name="theme-color" content="#212129">
        <style>
          :root { color-scheme: dark; }
          html, body { height: 100%; margin: 0; background: #212129; color: #ECEDF3;
            font: 15px -apple-system, system-ui, sans-serif; }
          body { display: flex; align-items: center; justify-content: center; text-align: center; }
          h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
          p { color: #AEB2C4; margin: 0 0 20px; max-width: 320px; }
          button { font: inherit; font-weight: 600; color: #212129; background: #AFB8F2; border: 0;
            border-radius: 8px; padding: 10px 20px; cursor: pointer; }
        </style>
        <div>
          <h1>You're offline</h1>
          <p>DCU Timetable needs the internet the first time it opens. It will load as soon as you're back online.</p>
          <button onclick="location.href = '\(address.absoluteString)'">Try Again</button>
        </div>
        """
    }
}
