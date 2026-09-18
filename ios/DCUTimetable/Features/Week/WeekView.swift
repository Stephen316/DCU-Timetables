import SwiftUI

struct WeekView: View {
    let programme: TimetableCategory
    let source: TimetableSource
    let title: String
    let resetLabel: String
    let onReset: () -> Void

    /// Owned by `TimetableShell`, not by this view — the deadlines tab reads the same
    /// model for the module list, and two copies would fetch the timetable twice.
    @ObservedObject var model: WeekViewModel
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @AppStorage("weekShowsCalendar") private var showsCalendar = false
    @State private var showingGroups = false
    @State private var showingEngLabs = false
    /// Mon–Fri index for the day view (0 = Monday).
    @State private var dayIndex = 0
    /// The class whose page is open, pushed from a day row or a calendar block.
    @State private var selectedEvent: TimetableEvent?
    @AppStorage(Attendance.storageKey) private var skippedData = Data()
    @Environment(\.scenePhase) private var scenePhase

    init(model: WeekViewModel,
         programme: TimetableCategory,
         source: TimetableSource = DCUAPIClient(),
         title: String? = nil,
         resetLabel: String = "Change programme",
         onReset: @escaping () -> Void) {
        self.model = model
        self.programme = programme
        self.source = source
        self.title = title ?? programme.code
        self.resetLabel = resetLabel
        self.onReset = onReset
    }

    var body: some View {
        NavigationStack {
            timetable
                .navigationDestination(item: $selectedEvent) { event in
                    // The same stores and the deadlines already in hand, so the page opens
                    // with content instead of a spinner over a second copy of the fetch.
                    LectureDetailView(event: event,
                                      isClashing: model.clashingIDs.contains(event.id),
                                      knownDeadlines: model.deadlines,
                                      cancellations: model.cancellationStore,
                                      deadlines: model.deadlineStore)
                }
                .onChange(of: selectedEvent) { _, newValue in
                    // Back from a class's page: a report or a deadline may have been added
                    // there, and both decide what the timetable outlines.
                    guard newValue == nil else { return }
                    Task {
                        await model.refreshCancellations()
                        await model.refreshDeadlines()
                    }
                }
                .onChange(of: model.weekIndex) { _, _ in
                    Task { await model.loadCurrentWeek() }
                }
                .onChange(of: model.weekStart) { _, _ in
                    resetToDefaultDay()
                }
                .onChange(of: scenePhase) { previous, phase in
                    // Coming back to the app is a fresh look at the timetable: whatever day
                    // was last swiped to is stale, so start again from today (or tomorrow
                    // evening). Only after a real trip to the background — pulling down
                    // Control Centre gives .inactive, and shouldn't discard the day being read.
                    if previous == .background, phase == .active { resetToDefaultDay() }
                }
                .onChange(of: hiddenGroupsData) { _, newValue in
                    model.updateHiddenGroups(HiddenGroups.decode(newValue))
                }
        }
    }

    /// The screen itself. Split from `body`'s modifiers because one chain of this length
    /// defeats the type-checker.
    private var timetable: some View {
        pages
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .overlay { if model.isLoading && model.events.isEmpty { ProgressView() } }
            .task { await model.start() }
            .sheet(isPresented: $showingGroups) {
                GroupSelectionView(programme: programme, source: source)
            }
            .sheet(isPresented: $showingEngLabs) {
                EngineeringLabsView()
            }
    }

    /// Extracted from `body` for the type-checker's sake, same as `pages`.
    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { showsCalendar.toggle() }
                } label: {
                    Image(systemName: showsCalendar ? "list.bullet" : "calendar")
                }
                .accessibilityLabel(showsCalendar ? "Show list" : "Show weekly calendar")
            }
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(title).font(.headline)
                    HStack(spacing: 3) {
                        Text(model.weekLabel)
                        if let campus = model.campusName {
                            Image(systemName: "mappin.and.ellipse")
                            Text(campus)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                // Disabled at each end of the year rather than silently doing nothing.
                Button { model.stepIndex(by: -1) } label: {
                    Image(systemName: "chevron.left")
                }
                .disabled(!model.canStep(by: -1))
                .accessibilityLabel("Previous week")
                Spacer()
                Button { model.stepIndex(by: 1) } label: {
                    Image(systemName: "chevron.right")
                }
                .disabled(!model.canStep(by: 1))
                .accessibilityLabel("Next week")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Select groups", systemImage: "person.2") { showingGroups = true }
                    if model.hasEngineeringLabs {
                        Button("Engineering labs", systemImage: "wrench.and.screwdriver") {
                            showingEngLabs = true
                        }
                    }
                    Button(resetLabel, systemImage: "arrow.left.arrow.right",
                           action: onReset)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
            
    }

    /// The week grid or the day list, whichever is switched on. Extracted from `body`
    /// because the modifier chain below it is already at the type-checker's limit.
    @ViewBuilder
    private var pages: some View {
        if let error = model.errorText, model.events.isEmpty {
            ContentUnavailableView("Couldn't load", systemImage: "wifi.exclamationmark",
                                   description: Text(error))
        } else if showsCalendar {
            // Same pager as the day view — weeks instead of days.
            WrappingPager(count: max(model.weeks.count, 1),
                          bounds: WeekViewModel.weekBounds,
                          index: $model.weekIndex) { index in
                WeekCalendarView(eventsByDay: model.eventsByDay(forWeekIndex: index),
                                 clashingIDs: model.clashingIDs,
                                 highlight: { model.highlight(for: $0) },
                                 onSelect: { selectedEvent = $0 })
            }
        } else {
            WrappingPager(count: max(weekDays.count, 1), index: $dayIndex) { day in
                dayList(for: day)
            }
        }
    }

    /// Mon–Fri of the week on screen.
    private var weekDays: [Date] {
        guard let start = model.weekStart else { return [] }
        let cal = Calendar.current
        let monday = cal.startOfDay(for: start)
        return (0..<5).compactMap { cal.date(byAdding: .day, value: $0, to: monday) }
    }

    @ViewBuilder
    private func dayList(for index: Int) -> some View {
        let day = weekDays.indices.contains(index) ? weekDays[index] : nil
        let slots = DaySchedule.slots(for: day.map(self.events(on:)) ?? [])
        List {
            Section {
                if slots.isEmpty {
                    Text("No classes").foregroundStyle(.secondary)
                } else {
                    let skipped = Attendance.decode(skippedData)
                    ForEach(slots) { slot in
                        switch slot {
                        case .session(let event):
                            EventRow(event: event,
                                     isClashing: model.clashingIDs.contains(event.id),
                                     highlight: model.highlight(for: event),
                                     isSkipped: skipped.contains(CancellationRules.eventKey(for: event)),
                                     onSelect: { selectedEvent = event })
                        case .gap(let gap):
                            GapRow(gap: gap)
                        }
                    }
                }
            } header: {
                dayHeader(day, slots: slots)
            }
        }
        .listStyle(.grouped)
    }

    /// The date, plus how much of the day is actually free — the number a student is doing
    /// in their head when they look at a day with holes in it.
    @ViewBuilder
    private func dayHeader(_ day: Date?, slots: [DaySlot]) -> some View {
        let free = DaySchedule.freeMinutes(in: slots)
        HStack {
            Text(day.map(dayTitle) ?? "")
            if free > 0 {
                Spacer()
                Text(DaySchedule.freeLabel(minutes: free))
            }
        }
    }

    private func events(on day: Date) -> [TimetableEvent] {
        model.eventsByDay.first { Calendar.current.isDate($0.day, inSameDayAs: day) }?.events ?? []
    }

    /// Friday evening and the weekend want Monday of the *next* week, so this can move the
    /// pager as well as the day. Stepping changes `weekStart`, which calls this again — the
    /// second pass finds the day inside the new week and stops.
    private func resetToDefaultDay() {
        guard let start = model.weekStart else { return }
        let target = DefaultDay.target(weekStart: start)
        dayIndex = target.dayIndex
        if target.weekStep != 0 { model.stepIndex(by: target.weekStep) }
    }


    private func dayTitle(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
}

/// The empty stretch between two classes.
///
/// Drawn on the list's own background rather than on a row, so a gap is literally a hole in
/// the column of classes — the same way free time in the weekly grid is just background with
/// no block on it. On a white row it read as another entry, which is the opposite of what it
/// means.
///
/// The left column carries the same times in the same place as `EventRow`, so the edge of
/// the list reads as one continuous clock down the day — that column is what makes a gap
/// legible at a glance, not the label.
private struct GapRow: View {
    let gap: DayGap

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(gap.start.formatted(date: .omitted, time: .shortened))
                    .font(.subheadline).monospacedDigit()
                Text(gap.end.formatted(date: .omitted, time: .shortened))
                    .font(.caption).monospacedDigit()
            }
            .foregroundStyle(.tertiary)
            .frame(width: 60, alignment: .trailing)

            Line()
                .stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(.quaternary)
                .frame(height: 1)

            Text(gap.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .layoutPriority(1)
        }
        .padding(.vertical, 6)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(gap.label), \(gap.start.formatted(date: .omitted, time: .shortened)) to \(gap.end.formatted(date: .omitted, time: .shortened))")
    }
}

/// A single horizontal rule. `Divider()` can't be dashed.
private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

private struct EventRow: View {
    let event: TimetableEvent
    let isClashing: Bool
    var highlight: ClassHighlight?
    /// Marked "I won't attend". Dimmed rather than hidden — it's still on, and the student
    /// can change their mind.
    var isSkipped = false
    var onSelect: () -> Void = {}

    /// Read at tap time, not at build time — this is how a swipe that ends on this row is
    /// told apart from a tap on it.
    @Environment(\.pagerDrag) private var pagerDrag

    var body: some View {
        // A plain tap opens the class's page; reporting used to hide behind a long press,
        // which nobody found.
        Button {
            guard !pagerDrag.isSuppressingTaps() else { return }
            onSelect()
        } label: {
            card.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let highlight {
                Label(highlight.reason, systemImage: highlight.symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(highlight.tint)
            }
            rowBody
        }
        .opacity(isSkipped ? 0.45 : 1)
        .padding(highlight == nil ? 0 : 8)
        .overlay {
            if let highlight {
                RoundedRectangle(cornerRadius: 4).strokeBorder(highlight.tint, lineWidth: 2)
            }
        }
    }

    private var rowBody: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(event.start.formatted(date: .omitted, time: .shortened))
                    .font(.subheadline).monospacedDigit()
                Text(event.end.formatted(date: .omitted, time: .shortened))
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            .frame(width: 60, alignment: .trailing)

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.headline)
                Text(event.activity.summary)
                    .font(.caption).foregroundStyle(.secondary)
                // One flowing string so a long room description wraps cleanly instead of
                // leaving the delivery label stranded on the first line.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "mappin.and.ellipse").font(.caption2)
                    Text("\(event.locationDisplay) · \(event.type.label)")
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(.secondary)
                if let staff = event.staffText {
                    Text(staff).font(.caption2).foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)

            if isSkipped {
                Image(systemName: "person.slash")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("You're not attending this")
            }

            if isClashing {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(TimetableTint.off)
                    .help("Overlaps another class")
            }
        }
        .padding(.vertical, 2)
    }
}
