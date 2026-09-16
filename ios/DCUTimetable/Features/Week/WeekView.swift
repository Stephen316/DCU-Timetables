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
    /// Direction of the last page, so the slide matches the travel.
    @State private var forward = true

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
            ZStack {
                Group {
                    if model.eventsByDay.isEmpty && !model.isLoading {
                        ContentUnavailableView(
                            model.errorText ?? "No classes this week",
                            systemImage: model.errorText == nil ? "calendar" : "wifi.exclamationmark",
                            description: Text(model.errorText == nil
                                ? "Nothing scheduled for \(model.weekLabel.lowercased())."
                                : "")
                        )
                    } else if showsCalendar {
                        WeekCalendarView(eventsByDay: model.eventsByDay,
                                         clashingIDs: model.clashingIDs)
                    } else {
                        WrappingPager(count: weekDays.count, index: $dayIndex) { day in
                            dayList(for: day)
                        }
                    }
                }
                .id(model.weekLabel)
                .transition(slideTransition)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .contentShape(Rectangle())
            .pagingSwipe(onBack: { page(forward: false) },
                         onForward: { page(forward: true) })
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
                    Button { Task { await model.goToPreviousWeek() } } label: {
                        Image(systemName: "chevron.left")
                    }
                    Spacer()
                    if let updated = model.lastUpdated {
                        Text("Updated \(updated.formatted(.relative(presentation: .named)))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await model.goToNextWeek() } } label: {
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
            .overlay { if model.isLoading && model.events.isEmpty { ProgressView() } }
            .task { await model.start() }
            .sheet(isPresented: $showingGroups) {
                GroupSelectionView(programme: programme, source: source)
            }
            .sheet(isPresented: $showingEngLabs) {
                EngineeringLabsView()
            }
            .onChange(of: model.weekStart) { _, newValue in
                guard let start = newValue else { return }
                dayIndex = Self.defaultDayIndex(weekStart: start)
            }
            .onChange(of: hiddenGroupsData) { _, newValue in
                model.updateHiddenGroups(HiddenGroups.decode(newValue))
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
                                 isClashing: model.clashingIDs.contains(event.id))
                    }
                }
            }
        }
    }

    private func events(on day: Date) -> [TimetableEvent] {
        model.eventsByDay.first { Calendar.current.isDate($0.day, inSameDayAs: day) }?.events ?? []
    }

    /// Swiping pages the day in the day view (Mon–Fri, wrapping back to Monday) and the
    /// week in the calendar. The toolbar chevrons always page weeks, so the day view can
    /// still reach another week.
    private func page(forward goForward: Bool) {
        // The day view has its own interactive pager (WrappingPager); only the calendar
        // pages from this gesture, because neighbouring weeks aren't loaded yet.
        guard showsCalendar else { return }
        forward = goForward
        Task {
            if goForward { await model.goToNextWeek() } else { await model.goToPreviousWeek() }
        }
    }

    /// Open the day view on today when today is in the week being shown.
    private static func defaultDayIndex(weekStart: Date) -> Int {
        let cal = Calendar.current
        let offset = cal.dateComponents([.day],
                                        from: cal.startOfDay(for: weekStart),
                                        to: cal.startOfDay(for: Date())).day ?? 0
        return (0...4).contains(offset) ? offset : 0
    }

    /// The incoming page slides in from the direction of travel.
    private var slideTransition: AnyTransition {
        .asymmetric(insertion: .move(edge: forward ? .trailing : .leading),
                    removal: .move(edge: forward ? .leading : .trailing))
    }

    private func dayHeader(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
}

private struct EventRow: View {
    let event: TimetableEvent
    let isClashing: Bool

    var body: some View {
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
