import Foundation

/// The one value the app writes and the widgets read.
///
/// The app is React Native now, and writes the snapshot through `ExtensionStorage` from
/// `@bacons/apple-targets`: a JSON string under `snapshotKey` in the App Group's shared
/// `UserDefaults` (see `mobile/src/data/widgets.ts`). An App Group is the only way two
/// processes from the same developer can share storage, so the group id below has to match
/// the entitlement on **both** targets (`app.json` and `expo-target.config.js`). If it is
/// missing — a build signed without the capability — the suite comes back nil, the widget
/// reads nothing, and it shows its "open the app" state, which `isShared` makes visible.
public struct WidgetSnapshotStore: Sendable {
    public static let appGroup = "group.com.stephenh.dcutimetable"
    /// Must equal `WIDGET_SNAPSHOT_KEY` in `mobile/src/data/widgets.ts`.
    public static let snapshotKey = "widgetSnapshot"

    /// Widget kinds, named here so the app can reload a timeline without the extension's
    /// source and the two can't drift apart from a typo. The app's copies are in
    /// `mobile/src/data/widgets.ts`.
    public enum Kind {
        public static let timetable = "TimetableWidget"
        public static let deadlines = "DeadlinesWidget"
    }

    private let appGroup: String
    public let isShared: Bool

    public init(appGroup: String = WidgetSnapshotStore.appGroup) {
        self.appGroup = appGroup
        isShared = UserDefaults(suiteName: appGroup) != nil
    }

    public func read() -> WidgetSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let text = defaults.string(forKey: Self.snapshotKey) else { return .empty }
        return (try? Self.decoder.decode(WidgetSnapshot.self, from: Data(text.utf8))) ?? .empty
    }

    /// ISO-8601 without fractional seconds, which is what the app writes: the value outlives
    /// a build, and a date format nobody can read by eye is a bad thing to debug across two
    /// processes.
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
