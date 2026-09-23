import SwiftUI

/// A week laid out as a timetable grid: days across, hours down, classes as blocks.
/// Overlapping classes share the column width (see `WeekGrid`).
struct WeekCalendarView: View {
    let eventsByDay: [(day: Date, events: [TimetableEvent])]
    let clashingIDs: Set<String>
    /// What to outline each class with — nothing, something due today, a quiz, or a
    /// reported cancellation.
    var highlight: (TimetableEvent) -> ClassHighlight? = { _ in nil }
    /// Tapping a block opens the class's page, which the parent owns — the grid itself
    /// has no navigation stack.
    var onSelect: (TimetableEvent) -> Void = { _ in }
    /// See `PagerDragState`: a block must not open when the finger was swiping past it.
    @Environment(\.pagerDrag) private var pagerDrag

    /// Scaled with the block text, so a taller label gets a taller hour to sit in.
    @ScaledMetric(relativeTo: .caption2) private var hourHeight: CGFloat = 58
    @ScaledMetric(relativeTo: .caption2) private var gutterWidth: CGFloat = 40

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
        .background(Theme.canvas)
        // Five columns of blocks can't reflow the way a list can: past xxxLarge a block
        // holds a letter or two. The day list is the view that grows with the text, and
        // it's one tap away in the toolbar.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    // MARK: - Pieces

    private func dayHeader(dayWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutterWidth, height: 1)
            ForEach(displayDays, id: \.self) { day in
                VStack(spacing: 1) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated)))
                        .font(.caption2).foregroundStyle(Theme.inkSecondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.footnote.weight(isToday(day) ? .bold : .regular))
                        .foregroundStyle(isToday(day) ? Theme.accent : Theme.ink)
                }
                .frame(width: dayWidth)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                .accessibilityAddTraits(isToday(day) ? [.isHeader, .isSelected] : .isHeader)
            }
        }
        .padding(.vertical, 6)
    }

    private var hourGutter: some View {
        VStack(spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                Text(hourLabel(hour))
                    .font(.caption2)
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(width: gutterWidth, height: hourHeight, alignment: .topTrailing)
                    .padding(.trailing, 4)
                    .offset(y: -5)
            }
        }
        .frame(width: gutterWidth, height: gridHeight, alignment: .top)
        .accessibilityHidden(true)
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
                        Rectangle().fill(Theme.separator).frame(height: 0.5)
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
            Rectangle().fill(Theme.separator).frame(width: 0.5)
                .allowsHitTesting(false)
        }
    }

    private func block(_ item: WeekGrid.Placed, dayWidth: CGFloat) -> some View {
        let width = dayWidth / CGFloat(item.columnCount)
        let height = max(26, duration(of: item.event))
        let tint = tint(for: item.event)
        let isClashing = clashingIDs.contains(item.event.id)
        let highlight = highlight(item.event)

        return Button {
            guard !pagerDrag.isSuppressingTaps() else { return }
            onSelect(item.event)
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.event.moduleCode ?? item.event.title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if height > 44, let room = roomLabel(item.event) {
                    Text(room)
                        .font(.caption2)
                        .foregroundStyle(Theme.inkSecondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 3)
            .padding(.vertical, 2)
            .frame(width: max(width - 2, 10), height: height - 2, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: Theme.Radius.block).fill(tint.opacity(0.18)))
            .overlay(alignment: .leading) {
                Rectangle().fill(tint).frame(width: 2.5)
            }
            .overlay {
                // A highlight outranks a clash outline: not running, or a deadline today,
                // matters more than an overlap the student has already seen.
                RoundedRectangle(cornerRadius: Theme.Radius.block)
                    .strokeBorder(highlight?.tint
                                  ?? (isClashing ? TimetableTint.off.opacity(0.55) : Color.clear),
                                  lineWidth: highlight == nil ? 1.5 : 2)
            }
            .overlay(alignment: .topTrailing) {
                if let highlight {
                    Image(systemName: highlight.symbol)
                        .font(.caption2)
                        .imageScale(.small)
                        .foregroundStyle(highlight.tint)
                        .padding(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // The block shows two words; the spoken version carries the whole class.
        .accessibilityLabel(spokenSummary(item.event, highlight: highlight, isClashing: isClashing))
        .offset(x: CGFloat(item.column) * width, y: offsetY(for: item.event.start))
    }

    private func spokenSummary(_ event: TimetableEvent, highlight: ClassHighlight?,
                               isClashing: Bool) -> String {
        var parts: [String] = []
        if let highlight { parts.append(highlight.reason) }
        parts.append(event.title)
        parts.append("\(event.start.formatted(date: .omitted, time: .shortened)) to \(event.end.formatted(date: .omitted, time: .shortened))")
        if !event.locationDisplay.isEmpty { parts.append(event.locationDisplay) }
        if isClashing { parts.append("Overlaps another class") }
        return parts.joined(separator: ", ")
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

    private func tint(for event: TimetableEvent) -> Color {
        let key = event.moduleCode ?? event.title
        var hash = 5381
        for byte in key.utf8 { hash = (hash &* 33) &+ Int(byte) }
        let count = TimetableTint.modules.count
        return TimetableTint.modules[((hash % count) + count) % count]
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.week.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.week.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.week.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.week.view
}
#endif
