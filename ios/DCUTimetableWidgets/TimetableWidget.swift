import SwiftUI
import WidgetKit

/// One rendering of the day. `classes` is already narrowed to `date`'s calendar day, and
/// `highlightedID` already resolved, because a timeline entry is a picture — working
/// either of them out inside `body` would mean recomputing them on every redraw against a
/// `Date()` that is not the entry's date.
struct TimetableEntry: TimelineEntry {
    let date: Date
    let classes: [WidgetClass]
    let highlightedID: WidgetClass.ID?
    /// False when the app has never written a snapshot the widget could read.
    let hasData: Bool

    var highlighted: WidgetClass? {
        classes.first { $0.id == highlightedID }
    }

    /// Classes that have not finished yet. The day's list scrolls itself forward rather
    /// than keeping a 9am lecture at the top until midnight.
    var remaining: [WidgetClass] {
        classes.filter { $0.end > date }
    }
}

struct TimetableProvider: TimelineProvider {
    private let store = WidgetSnapshotStore()

    func placeholder(in context: Context) -> TimetableEntry {
        TimetableEntry(date: .now, classes: Self.sample, highlightedID: Self.sample.first?.id,
                       hasData: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (TimetableEntry) -> Void) {
        // The gallery preview gets invented classes rather than a real but possibly empty
        // day: a student browsing the widget picker needs to see what the widget looks
        // like when it has something to say.
        guard !context.isPreview else { return completion(placeholder(in: context)) }
        completion(entry(from: store.read(), at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimetableEntry>) -> Void) {
        let snapshot = store.read()
        let now = Date()
        // One entry now, then one at every instant the picture changes: each highlight
        // window opening and closing, each class ending, and midnight. WidgetKit draws
        // only the entries it is handed, so an instant with no entry is an instant the
        // widget spends showing the previous one.
        let dates = [now] + NextClassWindow.refreshDates(for: snapshot.classes, after: now)
            .prefix(Self.maxEntries - 1)
        let entries = dates.map { entry(from: snapshot, at: $0) }
        // `.atEnd` rather than a fixed interval: the last entry is the one that has run
        // out of day, and that is exactly when there is something new to work out.
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    /// WidgetKit keeps a timeline in memory; a week of five-class days would be a few
    /// hundred entries for no gain, since the app republishes whenever it is opened.
    private static let maxEntries = 48

    private func entry(from snapshot: WidgetSnapshot, at date: Date) -> TimetableEntry {
        let day = snapshot.classes(on: date)
        return TimetableEntry(date: date,
                              classes: day,
                              highlightedID: NextClassWindow.highlighted(in: day, at: date)?.id,
                              hasData: snapshot.updatedAt != .distantPast)
    }

    private static let sample: [WidgetClass] = {
        let start = Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: .now) ?? .now
        return [
            WidgetClass(id: "1", title: "Computer Systems", code: "CA106", room: "HG20",
                        start: start, end: start.addingTimeInterval(3600)),
            WidgetClass(id: "2", title: "Digital Innovation", code: "CA107", room: "L101",
                        start: start.addingTimeInterval(7200),
                        end: start.addingTimeInterval(10800)),
        ]
    }()
}

/// One class in the day's list.
struct TimetableRow: View {
    let item: WidgetClass
    let isHighlighted: Bool

    private var isOff: Bool { item.state == .cancelled }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(item.start.widgetTime)
                    .font(.caption)
                    .fontWeight(isHighlighted ? .semibold : .regular)
                    .monospacedDigit()
                Text(item.end.widgetTime)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            .frame(width: WidgetChrome.gutter, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.caption)
                    .fontWeight(isHighlighted ? .semibold : .regular)
                    // A cancelled class stays on the list — the student still has to know
                    // the hour is theirs — but struck through, so it reads as an hour they
                    // have back rather than one to turn up for.
                    .strikethrough(isOff, color: TimetableTint.off)
                    .lineLimit(1)
                detail
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        // The highlight is a fill plus weight, not a border: at this size a 1pt stroke
        // around a two-line row is thinner than the text it is meant to be framing.
        .background(isHighlighted ? Color.accentColor.opacity(0.16) : .clear,
                    in: RoundedRectangle(cornerRadius: 6))
        .padding(.horizontal, -6)
    }

    @ViewBuilder
    private var detail: some View {
        switch item.state {
        case .cancelled:
            Text("Cancelled")
                .font(.caption2)
                .foregroundStyle(TimetableTint.off)
        case .moved:
            Text("Moved · \(item.room)")
                .font(.caption2)
                .foregroundStyle(TimetableTint.off)
                .lineLimit(1)
        case .scheduled:
            Text(item.room.isEmpty ? item.code : item.room)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// The small family: one class, in full, rather than a list nobody can read.
struct TimetableSmallView: View {
    let entry: TimetableEntry

    /// What a 2×2 widget is for is the answer to "where am I supposed to be": the
    /// highlighted class when there is one, and otherwise the next one still to come —
    /// shown without the highlight, so the emphasis keeps meaning "now".
    private var focus: WidgetClass? {
        entry.highlighted ?? entry.remaining.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Today", detail: entry.date.formatted(.dateTime.weekday(.abbreviated)))
            if let focus {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(focus.start.widgetTime) – \(focus.end.widgetTime)")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(entry.highlighted == nil ? .secondary : Color.accentColor)
                    Text(focus.title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .strikethrough(focus.state == .cancelled, color: TimetableTint.off)
                        .lineLimit(2)
                    Text(focus.state == .cancelled ? "Cancelled" : focus.room)
                        .font(.caption2)
                        .foregroundStyle(focus.state == .scheduled ? .secondary : TimetableTint.off)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                WidgetOverflowInline(count: entry.remaining.count - 1)
            } else {
                WidgetEmptyState(symbol: emptySymbol, message: emptyMessage)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptySymbol: String { entry.hasData ? "checkmark.circle" : "arrow.down.app" }

    private var emptyMessage: String {
        guard entry.hasData else { return "Open DCU Timetable to fill this in" }
        return entry.classes.isEmpty ? "No classes today" : "Nothing left today"
    }
}

/// "+2 more" on its own line, without the list's leading gutter.
private struct WidgetOverflowInline: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("+\(count) more today")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

/// Medium and large: the rest of the day as a list.
struct TimetableListView: View {
    let entry: TimetableEntry
    let family: WidgetFamily

    /// Everything still ahead, but never dropping the highlighted class — a lecture that
    /// is half over has passed `end > date`'s test in every case except the one where the
    /// window is still open and it is the thing the student is sitting in.
    private var visible: [WidgetClass] {
        var list = entry.remaining
        if let highlighted = entry.highlighted, !list.contains(where: { $0.id == highlighted.id }) {
            list.insert(highlighted, at: 0)
        }
        return list
    }

    private var shown: ArraySlice<WidgetClass> {
        visible.prefix(WidgetChrome.rowLimit(for: family))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "Today",
                         detail: entry.date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
            if visible.isEmpty {
                WidgetEmptyState(symbol: entry.hasData ? "checkmark.circle" : "arrow.down.app",
                                 message: entry.hasData
                                     ? (entry.classes.isEmpty ? "No classes today" : "Nothing left today")
                                     : "Open DCU Timetable to fill this in")
            } else {
                ForEach(shown) { item in
                    TimetableRow(item: item, isHighlighted: item.id == entry.highlightedID)
                }
                WidgetOverflow(count: visible.count - shown.count)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct TimetableWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TimetableEntry

    var body: some View {
        Group {
            if family == .systemSmall {
                TimetableSmallView(entry: entry)
            } else {
                TimetableListView(entry: entry, family: family)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct TimetableWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshotStore.Kind.timetable,
                            provider: TimetableProvider()) { entry in
            TimetableWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Today's classes")
        .description("The rest of today, with the class you're due at next picked out.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
