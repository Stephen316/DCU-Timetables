import SwiftUI
import WidgetKit

struct DeadlinesEntry: TimelineEntry {
    let date: Date
    let deadlines: [WidgetDeadline]
    let hasData: Bool
}

struct DeadlinesProvider: TimelineProvider {
    private let store = WidgetSnapshotStore()

    func placeholder(in context: Context) -> DeadlinesEntry {
        DeadlinesEntry(date: .now, deadlines: Self.sample, hasData: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (DeadlinesEntry) -> Void) {
        guard !context.isPreview else { return completion(placeholder(in: context)) }
        completion(entry(from: store.read(), at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlinesEntry>) -> Void) {
        let snapshot = store.read()
        let now = Date()
        let calendar = Calendar.current
        // Midnights, and nothing else. Every word this widget shows — which deadlines are
        // still listed, and whether one reads "today" or "tomorrow" — changes on the day
        // boundary and at no other time, so an hourly refresh would redraw the same
        // picture twenty-three times for nothing.
        let midnights = (1...7).compactMap {
            calendar.date(byAdding: .day, value: $0, to: calendar.startOfDay(for: now))
        }
        let entries = ([now] + midnights).map { entry(from: snapshot, at: $0) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    private func entry(from snapshot: WidgetSnapshot, at date: Date) -> DeadlinesEntry {
        DeadlinesEntry(date: date,
                       deadlines: snapshot.upcomingDeadlines(at: date),
                       hasData: snapshot.updatedAt != .distantPast)
    }

    private static let sample: [WidgetDeadline] = [
        WidgetDeadline(id: "1", title: "Lab 4 write-up", code: "CA106",
                       due: .now.addingTimeInterval(86_400), symbol: "flask", isSatInClass: false),
        WidgetDeadline(id: "2", title: "Midterm", code: "CA116",
                       due: .now.addingTimeInterval(4 * 86_400), symbol: "graduationcap",
                       isSatInClass: true),
    ]
}

struct DeadlineRow: View {
    let item: WidgetDeadline
    let now: Date

    /// Due today, or sat in a room. Both are the cases where noticing it a day late is
    /// not recoverable, which is the only thing worth spending colour on here.
    private var isUrgent: Bool {
        item.isSatInClass || Calendar.current.isDate(item.due, inSameDayAs: now)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: item.symbol)
                .font(.caption)
                .foregroundStyle(isUrgent ? TimetableTint.test : Color.secondary)
                .frame(width: 16, alignment: .leading)
                .frame(width: WidgetChrome.gutter - 24, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.caption)
                    .fontWeight(isUrgent ? .semibold : .regular)
                    .lineLimit(1)
                Text("\(item.code) · \(DeadlineCountdown.text(to: item.due, from: now))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
    }
}

struct DeadlinesSmallView: View {
    let entry: DeadlinesEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Due next", detail: nil)
            if let next = entry.deadlines.first {
                VStack(alignment: .leading, spacing: 2) {
                    Label(DeadlineCountdown.text(to: next.due, from: entry.date),
                          systemImage: next.symbol)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(next.title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .lineLimit(2)
                    Text(next.code)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if entry.deadlines.count > 1 {
                    Text("+\(entry.deadlines.count - 1) more")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                WidgetEmptyState(symbol: entry.hasData ? "checkmark.circle" : "arrow.down.app",
                                 message: entry.hasData
                                     ? "Nothing due"
                                     : "Open DCU Timetable to fill this in")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct DeadlinesListView: View {
    let entry: DeadlinesEntry
    let family: WidgetFamily

    private var shown: ArraySlice<WidgetDeadline> {
        entry.deadlines.prefix(WidgetChrome.rowLimit(for: family))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "Deadlines", detail: subtitle)
            if entry.deadlines.isEmpty {
                WidgetEmptyState(symbol: entry.hasData ? "checkmark.circle" : "arrow.down.app",
                                 message: entry.hasData
                                     ? "Nothing due"
                                     : "Open DCU Timetable to fill this in")
            } else {
                ForEach(shown) { item in
                    DeadlineRow(item: item, now: entry.date)
                }
                WidgetOverflow(count: entry.deadlines.count - shown.count)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Counted separately because a quiz you have to sit cannot be handed in late — the
    /// same split the deadlines tab makes.
    private var subtitle: String? {
        let tests = entry.deadlines.filter(\.isSatInClass).count
        guard tests > 0 else { return nil }
        return tests == 1 ? "1 sat in class" : "\(tests) sat in class"
    }
}

struct DeadlinesWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DeadlinesEntry

    var body: some View {
        Group {
            if family == .systemSmall {
                DeadlinesSmallView(entry: entry)
            } else {
                DeadlinesListView(entry: entry, family: family)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct DeadlinesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshotStore.Kind.deadlines,
                            provider: DeadlinesProvider()) { entry in
            DeadlinesWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Deadlines")
        .description("What's due next across your modules.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
