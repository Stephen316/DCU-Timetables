import Foundation

/// The one file the app writes and the widgets read.
///
/// An App Group is the only way two processes from the same developer can share a
/// container, so the group id below has to match the entitlement on **both** targets
/// (see `project.yml`). If it is missing — a build signed without the capability — the
/// container URL comes back nil and this falls back to the app's own Application Support
/// directory. That is not a working share: the app writes somewhere the widget cannot
/// read, and the widget shows its "open the app" state forever. It is still better than
/// trapping on a nil URL, and `isShared` says which of the two is happening.
public struct WidgetSnapshotStore: Sendable {
    public static let appGroup = "group.com.stephenh.dcutimetable"

    /// Widget kinds, named here so the app can reload a timeline without the extension's
    /// source and the two can't drift apart from a typo.
    public enum Kind {
        public static let timetable = "TimetableWidget"
        public static let deadlines = "DeadlinesWidget"
    }

    private let fileURL: URL?
    public let isShared: Bool

    public init(appGroup: String = WidgetSnapshotStore.appGroup,
                fileName: String = "widget-snapshot.json") {
        let fileManager = FileManager.default
        if let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            fileURL = container.appendingPathComponent(fileName)
            isShared = true
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            fileURL = base?.appendingPathComponent(fileName)
            isShared = false
        }
    }

    public func read() -> WidgetSnapshot {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return .empty }
        return (try? Self.decoder.decode(WidgetSnapshot.self, from: data)) ?? .empty
    }

    /// Atomic because the widget can be reading while the app writes; a torn file would
    /// decode as nil and blank the widget for no reason.
    public func write(_ snapshot: WidgetSnapshot) {
        guard let fileURL, let data = try? Self.encoder.encode(snapshot) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// ISO-8601 both ways rather than the default `Double` since 2001: the file outlives a
    /// build, and a date format nobody can read by eye is a bad thing to debug across two
    /// processes.
    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
