import SwiftUI

/// A week laid out as a timetable grid: days across, hours down, classes as blocks.
/// Overlapping classes share the column width (see `WeekGrid`).
struct WeekCalendarView: View {
    let eventsByDay: [(day: Date, events: [TimetableEvent])]
    let clashingIDs: Set<String>
    var cancellation: (TimetableEvent) -> CancellationStatus = { _ in
        CancellationStatus(reportCount: 0, reportedByMe: false)
    }
    var onToggleReport: (TimetableEvent) -> Void = { _ in }
    @State private var selected: TimetableEvent?

    private let hourHeight: CGFloat = 58
    private let gutterWidth: CGFloat = 40

    private var calendar: Calendar {
        var cal = Calendar.current
        cal.firstWeekday = 2          // Monday
        return cal
    }

    private var allEvents: [TimetableEvent] { eventsByDay.flatMap(\.events) }

    /// Mon–Fri, plus a weekend day only when something is scheduled on it.
    private var displayDays: [Date] {
        guard let first = eventsByDay.first?.day,
              let weekStart = calendar.dateInterval(of: .weekOfYear, for: first)?.start
        else { return eventsByDay.map(\.day) }

        let scheduled = Set(eventsByDay.map { calendar.startOfDay(for: $0.day) })
        return (0..<7).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: weekStart) else { return nil }
            let start = calendar.startOfDay(for: day)
            let weekday = calendar.component(.weekday, from: start)
            let isWeekend = weekday == 1 || weekday == 7
            return (!isWeekend || scheduled.contains(start)) ? start : nil
        }
    }

    private var hours: [Int] {
        guard !allEvents.isEmpty else { return Array(9...18) }
        let starts = allEvents.map { calendar.component(.hour, from: $0.start) }
        let ends = allEvents.map { event -> Int in
            let hour = calendar.component(.hour, from: event.end)
            return calendar.component(.minute, from: event.end) > 0 ? hour + 1 : hour
        }
        let low = starts.min() ?? 9
        let high = max((ends.max() ?? 18), low + 1)
        return Array(low...high)
    }

    private var gridHeight: CGFloat { CGFloat(hours.count) * hourHeight }

    var body: some View {
        GeometryReader { geo in
            let columns = max(displayDays.count, 1)
            let dayWidth = max(58, (geo.size.width - gutterWidth - 8) / CGFloat(columns))

            VStack(spacing: 0) {
                dayHeader(dayWidth: dayWidth)
                Divider()
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: 0) {
                        hourGutter
                        ForEach(displayDays, id: \.self) { day in
                            dayColumn(day, width: dayWidth)
                        }
                    }
                    .padding(.bottom, 64)
                }
            }
        }
        .sheet(item: $selected) { event in
            EventDetailSheet(event: event,
                             isClashing: clashingIDs.contains(event.id),
                             status: cancellation(event),
                             onToggleReport: { onToggleReport(event) })
                .presentationDetents([.medium])
        }
    }

    // MARK: - Pieces

    private func dayHeader(dayWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutterWidth, height: 1)
            ForEach(displayDays, id: \.self) { day in
                VStack(spacing: 1) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated)))
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.footnote.weight(isToday(day) ? .bold : .regular))
                        .foregroundStyle(isToday(day) ? Color.accentColor : .primary)
                }
                .frame(width: dayWidth)
            }
        }
        .padding(.vertical, 6)
    }

    private var hourGutter: some View {
        VStack(spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                Text(hourLabel(hour))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(width: gutterWidth, height: hourHeight, alignment: .topTrailing)
                    .padding(.trailing, 4)
                    .offset(y: -5)
            }
        }
        .frame(width: gutterWidth, height: gridHeight, alignment: .top)
    }

    private func dayColumn(_ day: Date, width: CGFloat) -> some View {
        let dayEvents = eventsByDay
            .first { calendar.isDate($0.day, inSameDayAs: day) }?.events ?? []
        let placed = WeekGrid.place(dayEvents)

        return ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(hours, id: \.self) { _ in
                    ZStack(alignment: .top) {
                        Color.clear.frame(height: hourHeight)
                        Rectangle().fill(Color.secondary.opacity(0.15)).frame(height: 0.5)
                    }
                }
            }
            .allowsHitTesting(false)
            ForEach(placed) { item in
                block(item, dayWidth: width)
            }
        }
        .frame(width: width, height: gridHeight, alignment: .topLeading)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.secondary.opacity(0.15)).frame(width: 0.5)
                .allowsHitTesting(false)
        }
    }

    private func block(_ item: WeekGrid.Placed, dayWidth: CGFloat) -> some View {
        let width = dayWidth / CGFloat(item.columnCount)
        let height = max(26, duration(of: item.event))
        let tint = tint(for: item.event)
        let isClashing = clashingIDs.contains(item.event.id)
        let flagged = cancellation(item.event).isFlagged

        return Button {
            selected = item.event
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.event.moduleCode ?? item.event.title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                if height > 44, let room = roomLabel(item.event) {
                    Text(room)
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 3)
            .padding(.vertical, 2)
            .frame(width: max(width - 2, 10), height: height - 2, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 4).fill(tint.opacity(0.18)))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2).fill(tint).frame(width: 2.5)
            }
            .overlay {
                // A crowd-reported cancellation outranks a clash outline.
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(flagged ? Color.orange
                                  : (isClashing ? Color.orange.opacity(0.55) : Color.clear),
                                  lineWidth: flagged ? 2 : 1.5)
            }
            .overlay(alignment: .topTrailing) {
                if flagged {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(.orange)
                        .padding(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .offset(x: CGFloat(item.column) * width, y: offsetY(for: item.event.start))
    }

    // MARK: - Geometry helpers

    private func offsetY(for date: Date) -> CGFloat {
        let hour = calendar.component(.hour, from: date)
        let minute = calendar.component(.minute, from: date)
        let minutesIn = (hour - (hours.first ?? 9)) * 60 + minute
        return CGFloat(minutesIn) / 60 * hourHeight
    }

    private func duration(of event: TimetableEvent) -> CGFloat {
        CGFloat(event.end.timeIntervalSince(event.start)) / 3600 * hourHeight
    }

    private func isToday(_ day: Date) -> Bool { calendar.isDateInToday(day) }

    private func hourLabel(_ hour: Int) -> String {
        let suffix = hour < 12 ? "am" : "pm"
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve)\(suffix)"
    }

    private func roomLabel(_ event: TimetableEvent) -> String? {
        guard let first = event.parsedLocations.first else { return nil }
        return first.buildingName ?? first.code
    }

    private static let palette: [Color] = [.blue, .green, .purple, .teal, .indigo, .pink, .brown]

    private func tint(for event: TimetableEvent) -> Color {
        let key = event.moduleCode ?? event.title
        var hash = 5381
        for byte in key.utf8 { hash = (hash &* 33) &+ Int(byte) }
        let count = Self.palette.count
        return Self.palette[((hash % count) + count) % count]
    }
}

/// Tapping a block shows the full detail the grid has no room for.
private struct EventDetailSheet: View {
    let event: TimetableEvent
    let isClashing: Bool
    let status: CancellationStatus
    let onToggleReport: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(event.title).font(.headline)
                    Text(event.activity.summary).foregroundStyle(.secondary)
                }
                Section {
                    LabeledContent("Time",
                        value: "\(event.start.formatted(date: .omitted, time: .shortened))–\(event.end.formatted(date: .omitted, time: .shortened))")
                    LabeledContent("Day", value: event.start.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
                    LabeledContent("Where", value: event.locationDisplay)
                    LabeledContent("Delivery", value: event.type.label)
                    if let staff = event.staffText {
                        LabeledContent("Staff", value: staff)
                    }
                }
                if isClashing {
                    Section {
                        Label("Overlaps another class", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
                Section {
                    if status.isFlagged {
                        Label("Reported not on · \(status.reportCount) people",
                              systemImage: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                    } else if status.reportCount > 0 {
                        Text("\(status.reportCount) of \(CancellationRules.threshold) people say this isn't on")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Button(role: status.reportedByMe ? nil : .destructive) {
                        onToggleReport()
                        dismiss()
                    } label: {
                        Label(status.reportedByMe ? "Undo my report" : "Report: lecture not on",
                              systemImage: status.reportedByMe ? "arrow.uturn.backward" : "exclamationmark.bubble")
                    }
                } footer: {
                    Text("Reports are anonymous. A class is flagged once \(CancellationRules.threshold) people report it.")
                }
            }
            .navigationTitle(event.moduleCode ?? "Class")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
        }
    }
}
