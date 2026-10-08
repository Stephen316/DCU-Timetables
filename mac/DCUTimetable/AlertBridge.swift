import AppKit
import UserNotifications
import WebKit

/// Class alerts for the web build, which can't schedule a notification itself. The page's
/// `MacAlertScheduler` (mobile/src/data/macShell.ts) posts here, and these become ordinary
/// Mac notifications, so they fire with the window closed. A clicked one opens its class.
///
/// Messages are `{ kind, … }`; every one is answered, so the page can await it.
@MainActor
final class AlertBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "dcuMac"

    weak var window: WebWindowController?

    /// A click that launched the app, held until the page asks for it: it may not have loaded.
    private var pendingTap: String?

    private var center: UNUserNotificationCenter { .current() }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else {
            return replyHandler(nil, "Unreadable message")
        }
        Task {
            switch kind {
            case "alerts.permission":
                replyHandler(await permission(), nil)
            case "alerts.request":
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
                replyHandler(await permission(), nil)
            case "alerts.replace":
                await replace(with: (body["alerts"] as? [[String: Any]] ?? []).compactMap(PlannedAlert.init))
                replyHandler(nil, nil)
            case "alerts.clear":
                center.removeAllPendingNotificationRequests()
                replyHandler(nil, nil)
            case "alerts.takeTap":
                replyHandler(pendingTap, nil)
                pendingTap = nil
            case "alerts.openSettings":
                if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                    NSWorkspace.shared.open(url)
                }
                replyHandler(nil, nil)
            default:
                replyHandler(nil, "Unknown message \(kind)")
            }
        }
    }

    private func permission() async -> String {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional: "granted"
        case .notDetermined: "undetermined"
        default: "denied"
        }
    }

    private func replace(with alerts: [PlannedAlert]) async {
        center.removeAllPendingNotificationRequests()
        guard await permission() == "granted" else { return }
        let now = Date()
        for alert in alerts where alert.fireAt > now {
            let content = UNMutableNotificationContent()
            content.title = alert.title
            content.body = alert.body
            content.sound = .default
            content.userInfo = ["eventID": alert.eventID]
            content.interruptionLevel = .timeSensitive
            // By the calendar, not an interval, so a Mac that sleeps through it still fires on time.
            let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: alert.fireAt)
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: trigger))
        }
    }

    fileprivate func open(eventID: String) {
        window?.showWindow(nil)
        NSApp.activate()
        pendingTap = eventID
        // Running: the page is listening. Launched by the click: it collects `pendingTap` instead.
        window?.evaluate("window.dispatchEvent(new Event('dcumac:alerttap'))")
    }
}

extension AlertBridge: UNUserNotificationCenterDelegate {
    /// Shown while the app is open too, as on the phone.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let id = response.notification.request.content.userInfo["eventID"] as? String
        else { return }
        await open(eventID: id)
    }
}

/// One alert as the page plans it (`PlannedAlert` in core/classAlerts.ts), the date in ms.
private struct PlannedAlert {
    let id: String
    let eventID: String
    let fireAt: Date
    let title: String
    let body: String

    init?(_ json: [String: Any]) {
        guard let id = json["id"] as? String, let eventID = json["eventID"] as? String,
              let millis = json["fireAt"] as? Double, let title = json["title"] as? String,
              let body = json["body"] as? String
        else { return nil }
        self.id = id
        self.eventID = eventID
        self.fireAt = Date(timeIntervalSince1970: millis / 1000)
        self.title = title
        self.body = body
    }
}
