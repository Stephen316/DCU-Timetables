import SwiftUI

/// One day of the timetable, drawn on the rail (see `TimeRail`).
///
/// This is the screen the app is opened for, so it is the one place the design is allowed
/// to be loud: the weekday set large and expanded, times as a clock down the left, and the
/// class to be heading to picked out in the accent. Everything else stays quiet.
struct DayPage: View {
    let day: Date?
    let events: [TimetableEvent]
    var clashingIDs: Set<String> = []
    var highlight: (TimetableEvent) -> ClassHighlight? = { _ in nil }
    /// Event keys marked "I won't attend".
    var skipped: Set<String> = []
    /// Holds back the empty state while the week is still arriving.
    var isLoading = false
    var onSelect: (TimetableEvent) -> Void = { _ in }

    var body: some View {
        // Redrawn each minute, so "Starts in 20 minutes" and the next-class stop move on
        // without a reload.
        TimelineView(.everyMinute) { context in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    DayHeading(day: day, slots: slots)
                        .padding(.horizontal, Theme.Space.l)
                        .padding(.top, Theme.Space.s)
                        .padding(.bottom, Theme.Space.l)
                    if sessions.isEmpty {
                        if !isLoading { emptyDay }
                    } else {
                        rail(now: context.date)
                    }
                }
                .padding(.bottom, Theme.Space.xxl)
            }
            .background(Theme.canvas)
        }
    }

    private var slots: [DaySlot] { DaySchedule.slots(for: events) }

    private var sessions: [TimetableEvent] {
        slots.compactMap { slot in
            if case .session(let event) = slot { return event }
            return nil
        }
    }

    private var isToday: Bool {
        day.map(Calendar.current.isDateInToday) ?? false
    }

    private func rail(now: Date) -> some View {
        let all = slots
        // The same rule the widget uses, so the app and the home screen never point at
        // different classes.
        let nextID = isToday
            ? NextClassWindow.highlighted(in: sessions.map(Self.windowClass), at: now)?.id
            : nil
        return LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(all.enumerated()), id: \.element.id) { index, slot in
                switch slot {
                case .session(let event):
                    ClassStop(event: event,
                              stop: stop(for: event, nextID: nextID, now: now),
                              position: .at(index, of: all.count),
                              highlight: highlight(event),
                              isClashing: clashingIDs.contains(event.id),
                              isSkipped: skipped.contains(CancellationRules.eventKey(for: event)),
                              now: now,
                              onSelect: { onSelect(event) })
                case .gap(let gap):
                    RailGap(start: gap.start, end: gap.end, label: gap.label)
                }
            }
        }
        .padding(.leading, Theme.Space.l)
    }

    /// News outranks "next": a cancelled class you'd otherwise be walking to is drawn in
    /// orange, because the thing to know about it is that it isn't on.
    private func stop(for event: TimetableEvent, nextID: String?, now: Date) -> RailStop {
        if let highlight = highlight(event) { return .flagged(highlight.tint) }
        if event.id == nextID { return .next }
        if isToday, event.end <= now { return .past }
        return .upcoming
    }

    private static func windowClass(_ event: TimetableEvent) -> WidgetClass {
        WidgetClass(id: event.id, title: event.title, code: event.moduleCode ?? "",
                    room: "", start: event.start, end: event.end)
    }

    private var emptyDay: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text("No classes")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
            Text("Swipe left or right for the rest of the week.")
                .font(.subheadline)
                .foregroundStyle(Theme.inkSecondary)
        }
        .padding(.horizontal, Theme.Space.l)
    }
}

/// "Wednesday", large, with the date and the day's free time under it.
private struct DayHeading: View {
    let day: Date?
    let slots: [DaySlot]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            weekday
            // Side by side while they fit; stacked at the large text sizes rather than
            // truncating either one.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                    Text(dateLine)
                    Spacer(minLength: 0)
                    freeTime
                }
                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    Text(dateLine)
                    freeTime
                }
            }
            .font(.subheadline)
            .foregroundStyle(Theme.inkSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// Expanded while it fits; standard width when it doesn't; and only then allowed to
    /// shrink. "Wednesday" in expanded type at AX5 is wider than an iPhone SE.
    private var weekday: some View {
        let name = day?.formatted(.dateTime.weekday(.wide)) ?? ""
        return ViewThatFits(in: .horizontal) {
            Text(name).font(.dayName).fixedSize()
            Text(name).font(.largeTitle.weight(.bold)).fixedSize()
            Text(name).font(.largeTitle.weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .foregroundStyle(Theme.ink)
    }

    private var dateLine: String {
        guard let day else { return "" }
        let date = day.formatted(.dateTime.day().month(.wide))
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today, \(date)" }
        if calendar.isDateInTomorrow(day) { return "Tomorrow, \(date)" }
        return date
    }

    @ViewBuilder
    private var freeTime: some View {
        let free = DaySchedule.freeMinutes(in: slots)
        if free > 0 {
            Text(DaySchedule.freeLabel(minutes: free) + " between classes")
        }
    }
}

/// A class on the rail: tap to open its page.
private struct ClassStop: View {
    let event: TimetableEvent
    let stop: RailStop
    let position: RailPosition
    let highlight: ClassHighlight?
    let isClashing: Bool
    /// Marked "I won't attend". Dimmed rather than hidden — it's still on, and the student
    /// can change their mind.
    let isSkipped: Bool
    let now: Date
    let onSelect: () -> Void

    /// Read at tap time, not at build time — this is how a swipe that ends on this row is
    /// told apart from a tap on it.
    @Environment(\.pagerDrag) private var pagerDrag

    var body: some View {
        Button {
            guard !pagerDrag.isSuppressingTaps() else { return }
            onSelect()
        } label: {
            RailRow(start: event.start, end: event.end, stop: stop, position: position) {
                details
            }
        }
        .buttonStyle(.row)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenSummary)
        .accessibilityHint("Opens the class")
        .accessibilityAddTraits(.isButton)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            if let highlight {
                Label(highlight.reason, systemImage: highlight.symbol)
                    .font(.status)
                    .foregroundStyle(highlight.tint)
            } else if stop == .next {
                Text(nextLine)
                    .font(.status)
                    .foregroundStyle(Theme.accent)
            }

            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(event.title)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if isSkipped {
                    Image(systemName: "person.slash")
                        .foregroundStyle(Theme.inkSecondary)
                }
                if isClashing {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(TimetableTint.off)
                }
            }

            Text(event.activity.summary)
                .font(.subheadline)
                .foregroundStyle(Theme.inkSecondary)

            if let place {
                Label(place, systemImage: event.type == .onCampus ? "mappin.and.ellipse" : "video")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let staff = event.staffText {
                Text(staff)
                    .font(.footnote)
                    .foregroundStyle(Theme.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .opacity(isSkipped ? 0.45 : (stop == .past ? 0.6 : 1))
    }

    /// The room, and how it's delivered only when that isn't "in the room": "On campus"
    /// on nearly every row is noise, "Online (live)" on one is the thing to notice.
    private var place: String? {
        let room = event.locationDisplay.trimmingCharacters(in: .whitespaces)
        let delivery = event.type == .onCampus ? nil : event.type.label
        let parts = [room.isEmpty ? nil : room, delivery].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private var nextLine: String {
        if now >= event.start { return "On now" }
        let minutes = Int((event.start.timeIntervalSince(now) / 60).rounded(.up))
        if minutes < 60 { return "Starts in \(minutes) min" }
        let hours = minutes / 60, rest = minutes % 60
        return rest == 0 ? "Starts in \(hours) hr" : "Starts in \(hours) hr \(rest) min"
    }

    private var spokenSummary: String {
        let time = "\(event.start.formatted(date: .omitted, time: .shortened)) to \(event.end.formatted(date: .omitted, time: .shortened))"
        var parts: [String] = []
        if let highlight { parts.append(highlight.reason) }
        else if stop == .next { parts.append(nextLine) }
        parts.append(event.title)
        parts.append(time)
        parts.append(event.activity.summary)
        if let place { parts.append(place) }
        if isClashing { parts.append("Overlaps another class") }
        if isSkipped { parts.append("You're not attending this") }
        if stop == .past { parts.append("Finished") }
        return parts.joined(separator: ", ")
    }
}
