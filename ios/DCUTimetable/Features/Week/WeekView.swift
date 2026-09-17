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
            Group {
                if let error = model.errorText, model.events.isEmpty {
                    ContentUnavailableView("Couldn't load", systemImage: "wifi.exclamationmark",
                                           description: Text(error))
                } else if showsCalendar {
                    // Same pager as the day view — weeks instead of days.
                    WrappingPager(count: max(model.weeks.count, 1), index: $model.weekIndex) { index in
                        WeekCalendarView(eventsByDay: model.eventsByDay(forWeekIndex: index),
                                         clashingIDs: model.clashingIDs,
                                         cancellation: { model.status(for: $0) },
                                         onToggleReport: { event in
                                             Task { await model.toggleReport(for: event) }
                                         })
                    }
                } else {
                    WrappingPager(count: max(weekDays.count, 1), index: $dayIndex) { day in
                        dayList(for: day)
                    }
                }
            }
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
            .overlay { if model.isLoading && model.events.isEmpty { ProgressView() } }
            .task { await model.start() }
            .sheet(isPresented: $showingGroups) {
                GroupSelectionView(programme: programme, source: source)
            }
            .sheet(isPresented: $showingEngLabs) {
                EngineeringLabsView()
            }
            .onChange(of: model.weekIndex) { _, _ in
                Task { await model.loadCurrentWeek() }
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
                                 isClashing: model.clashingIDs.contains(event.id),
                                 cancellation: model.status(for: event))
                            .contextMenu {
                                Button(model.status(for: event).reportedByMe
                                       ? "Undo \"not on\" report" : "Report: lecture not on",
                                       systemImage: model.status(for: event).reportedByMe
                                       ? "arrow.uturn.backward" : "exclamationmark.bubble") {
                                    Task { await model.toggleReport(for: event) }
                                }
                            }
                    }
                }
            }
        }
    }

    private func events(on day: Date) -> [TimetableEvent] {
        model.eventsByDay.first { Calendar.current.isDate($0.day, inSameDayAs: day) }?.events ?? []
    }

    /// Open the day view on today when today is in the week being shown.
    private static func defaultDayIndex(weekStart: Date) -> Int {
        let cal = Calendar.current
        let offset = cal.dateComponents([.day],
                                        from: cal.startOfDay(for: weekStart),
                                        to: cal.startOfDay(for: Date())).day ?? 0
        return (0...4).contains(offset) ? offset : 0
    }


    private func dayHeader(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
}

private struct EventRow: View {
    let event: TimetableEvent
    let isClashing: Bool
    var cancellation = CancellationStatus(reportCount: 0, reportedByMe: false)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if cancellation.isFlagged {
                Label("Reported not on · \(cancellation.reportCount) people",
                      systemImage: "exclamationmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            rowBody
        }
        .padding(cancellation.isFlagged ? 8 : 0)
        .overlay {
            if cancellation.isFlagged {
                RoundedRectangle(cornerRadius: 8).strokeBorder(.orange, lineWidth: 2)
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
