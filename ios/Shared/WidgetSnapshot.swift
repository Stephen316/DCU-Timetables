import Foundation

/// What the home-screen widgets draw, flattened.
///
/// A widget runs in its own process, so it cannot reach the app's container, its Keychain
/// items or its Supabase session. Rather than rebuild all three inside an extension, the
/// app writes everything the widgets need into a shared file and the extension only reads
/// (see `WidgetSnapshotStore`).
///
/// The types here are deliberately *not* the domain types. `TimetableEvent` carries staff
/// lists, week labels and an activity code the widget has no room for, and `Deadline`
/// carries a submitter and a module key it would have to resolve. Denormalising at write
/// time keeps the extension free of the whole `Core` layer, and keeps a change to a domain
/// type from silently changing what an already-installed widget decodes.
public struct WidgetClass: Codable, Sendable, Equatable, Identifiable {
    /// Why this class is not simply "on". The widget shows at most one flag per row, so
    /// this is one value rather than a set.
    public enum State: String, Codable, Sendable {
        case scheduled
        case cancelled
        case moved
    }

    public let id: String
    /// Module name where there is one, else the module code.
    public let title: String
    /// Module code, for the rows too narrow to carry the name.
    public let code: String
    /// Room text, already shortened — the widget has no room for "Henry Grattan, Room 86".
    public let room: String
    public let start: Date
    public let end: Date
    public let state: State

    public init(id: String, title: String, code: String, room: String,
                start: Date, end: Date, state: State = .scheduled) {
        self.id = id
        self.title = title
        self.code = code
        self.room = room
        self.start = start
        self.end = end
        self.state = state
    }

    /// Half the class's length, which is what both edges of the highlight window are
    /// measured in. Floored at five minutes so a zero-length or malformed event still has
    /// a window rather than blinking past in an instant.
    public var halfLength: TimeInterval {
        max(end.timeIntervalSince(start) / 2, 5 * 60)
    }
}

/// A deadline, flattened the same way.
public struct WidgetDeadline: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let code: String
    public let due: Date
    /// SF Symbol for the kind, resolved by the app so the extension needs no `DeadlineKind`.
    public let symbol: String
    /// Sat in a room rather than handed in — missing one is unrecoverable, so the widget
    /// marks them even though it has no space for the kind's name.
    public let isSatInClass: Bool

    public init(id: String, title: String, code: String, due: Date,
                symbol: String, isSatInClass: Bool) {
        self.id = id
        self.title = title
        self.code = code
        self.due = due
        self.symbol = symbol
        self.isSatInClass = isSatInClass
    }
}

/// One write from the app, read by both widgets.
public struct WidgetSnapshot: Codable, Sendable, Equatable {
    /// Every class in the week the app last had loaded, not just today's.
    ///
    /// A widget is not guaranteed a refresh at midnight — the system decides — so a
    /// snapshot holding only today's classes would show yesterday's day until the app
    /// next opened. Holding the week means the timeline can roll over on its own.
    public let classes: [WidgetClass]
    public let deadlines: [WidgetDeadline]
    /// Shown when the data is old enough to be worth doubting.
    public let updatedAt: Date

    public init(classes: [WidgetClass], deadlines: [WidgetDeadline], updatedAt: Date = Date()) {
        self.classes = classes
        self.deadlines = deadlines
        self.updatedAt = updatedAt
    }

    public static let empty = WidgetSnapshot(classes: [], deadlines: [],
                                             updatedAt: .distantPast)

    /// One calendar day's classes, in order.
    public func classes(on day: Date, calendar: Calendar = .current) -> [WidgetClass] {
        classes
            .filter { calendar.isDate($0.start, inSameDayAs: day) }
            .sorted { $0.start < $1.start }
    }

    /// Deadlines still ahead, soonest first. Matches `DeadlineRules.upcoming`: "past" means
    /// before today, not before this instant, so something due at 11am is still listed at
    /// 11:01 rather than vanishing off the widget while the student is writing it.
    public func upcomingDeadlines(at now: Date, calendar: Calendar = .current) -> [WidgetDeadline] {
        let floor = calendar.startOfDay(for: now)
        return deadlines.filter { $0.due >= floor }.sorted { $0.due < $1.due }
    }
}
