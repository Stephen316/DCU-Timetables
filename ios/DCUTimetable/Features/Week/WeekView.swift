import SwiftUI

struct WeekView: View {
    let programme: TimetableCategory
    let source: TimetableSource
    let title: String
    let resetLabel: String
    let onReset: () -> Void

    @StateObject private var model: WeekViewModel
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @AppStorage("weekShowsCalendar") private var showsCalendar = false
    @State private var showingGroups = false
    @State private var showingEngLabs = false
    /// Mon–Fri index for the day view (0 = Monday).
    @State private var dayIndex = 0
    /// The class whose page is open, pushed from a day row or a calendar block.
    @State private var selectedEvent: TimetableEvent?
    @Environment(\.scenePhase) private var scenePhase

    init(programme: TimetableCategory,
         source: TimetableSource = DCUAPIClient(),
         title: String? = nil,
         resetLabel: String = "Change programme",
         onReset: @escaping () -> Void) {
        self.programme = programme
        self.source = source
        self.title = title ?? programme.code
        self.resetLabel = resetLabel
        self.onReset = onReset
        let hidden = HiddenGroups.decode(UserDefaults.standard.data(forKey: "hiddenGroups") ?? Data())
        _model = StateObject(wrappedValue: WeekViewModel(programme: programme, hiddenGroups: hidden, source: source))
    }

    var body: some View {
        NavigationStack {
            timetable
                .navigationDestination(item: $selectedEvent) { event in
                    LectureDetailView(event: event,
                                      isClashing: model.clashingIDs.contains(event.id))
                }
                .onChange(of: selectedEvent) { _, newValue in
                    // Back from a class's page: its reports may have changed.
                    if newValue == nil { Task { await model.refreshCancellations() } }
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
                Button { model.stepIndex(by: -1) } label: {
                    Image(systemName: "chevron.left")
                }
                Spacer()
                if let updated = model.lastUpdated {
                    Text("Updated \(updated.formatted(.relative(presentation: .named)))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Button { model.stepIndex(by: 1) } label: {
                    Image(systemName: "chevron.right")
                }
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
            WrappingPager(count: max(model.weeks.count, 1), index: $model.weekIndex) { index in
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
        let events = day.map(self.events(on:)) ?? []
        List {
            Section(day.map(dayHeader) ?? "") {
                if events.isEmpty {
                    Text("No classes").foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        EventRow(event: event,
                                 isClashing: model.clashingIDs.contains(event.id),
                                 highlight: model.highlight(for: event),
                                 onSelect: { selectedEvent = event })
                    }
                }
            }
        }
    }

    private func events(on day: Date) -> [TimetableEvent] {
        model.eventsByDay.first { Calendar.current.isDate($0.day, inSameDayAs: day) }?.events ?? []
    }

    private func resetToDefaultDay() {
        guard let start = model.weekStart else { return }
        dayIndex = DefaultDay.index(weekStart: start)
    }


    private func dayHeader(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
}

private struct EventRow: View {
    let event: TimetableEvent
    let isClashing: Bool
    var highlight: ClassHighlight?
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
        .padding(highlight == nil ? 0 : 8)
        .overlay {
            if let highlight {
                RoundedRectangle(cornerRadius: 8).strokeBorder(highlight.tint, lineWidth: 2)
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

            if isClashing {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .help("Overlaps another class")
            }
        }
        .padding(.vertical, 2)
    }
}
