import Foundation
import WidgetKit

/// Turns what the timetable has on screen into the flat file the widgets read.
///
/// Lives on the app side, not in `Shared`, because this is the one place the domain types
/// and the widget types meet — putting it in `Shared` would drag `TimetableEvent`,
/// `Deadline` and everything they reference into the extension for no benefit.
///
/// Writing is cheap and idempotent, so it is called on every load rather than being
/// guarded by a "has anything changed?" check that would have to know as much as the
/// snapshot itself.
public enum WidgetSnapshotPublisher {
    /// Rooms are shown as bare codes ("FT301"), not `shortText`'s "Polaris, Room 301".
    /// A widget row is one line of ~11pt text; the building name is the first thing that
    /// truncates, and a truncated building name is worse than no building name.
    static func room(for event: TimetableEvent) -> String {
        let codes = event.parsedLocations.map(\.code).filter { !$0.isEmpty }
        return codes.isEmpty ? "" : codes.joined(separator: " · ")
    }

    static func widgetClass(for event: TimetableEvent,
                            status: CancellationStatus) -> WidgetClass {
        let state: WidgetClass.State
        if status.isFlagged {
            state = .cancelled
        } else if status.isMoved {
            state = .moved
        } else {
            state = .scheduled
        }
        return WidgetClass(id: event.id,
                           title: event.title,
                           code: event.moduleCode ?? event.activity.raw,
                           room: room(for: event),
                           start: event.start,
                           end: event.end,
                           state: state)
    }

    static func widgetDeadline(for deadline: Deadline) -> WidgetDeadline {
        WidgetDeadline(id: deadline.id,
                       title: deadline.title,
                       code: deadline.moduleKey,
                       due: deadline.due,
                       symbol: deadline.kind.symbol,
                       isSatInClass: deadline.kind.isSatInClass)
    }

    public static func snapshot(events: [TimetableEvent],
                                deadlines: [Deadline],
                                status: (TimetableEvent) -> CancellationStatus,
                                now: Date = Date()) -> WidgetSnapshot {
        WidgetSnapshot(classes: events.map { widgetClass(for: $0, status: status($0)) }
                                      .sorted { $0.start < $1.start },
                       // The same horizon the deadlines tab uses, so the widget can't list
                       // something the app has already dropped.
                       deadlines: DeadlineRules.upcoming(deadlines, now: now)
                                               .map(widgetDeadline(for:)),
                       updatedAt: now)
    }

    /// Writes the snapshot and asks WidgetKit to redraw.
    ///
    /// `reloadTimelines(ofKind:)` rather than `reloadAllTimelines()`: both widgets read
    /// this file, but naming them keeps the call honest about what it invalidates, and
    /// costs nothing.
    public static func publish(events: [TimetableEvent],
                               deadlines: [Deadline],
                               status: (TimetableEvent) -> CancellationStatus,
                               store: WidgetSnapshotStore = WidgetSnapshotStore(),
                               now: Date = Date()) {
        store.write(snapshot(events: events, deadlines: deadlines, status: status, now: now))
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshotStore.Kind.timetable)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshotStore.Kind.deadlines)
    }
}
