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
    @State private var showingAccount = false
    /// Mon–Fri index for the day view (0 = Monday).
    @State private var dayIndex = 0
    /// The class whose page is open, pushed from a day row or a calendar block.
    @State private var selectedEvent: TimetableEvent?
    @AppStorage(Attendance.storageKey) private var skippedData = Data()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                .onReceive(NotificationCenter.default
                    .publisher(for: .labRotationChanged)
                    .receive(on: RunLoop.main)) { _ in
                        Task { await model.reloadAll() }
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
            .background(Theme.canvas.ignoresSafeArea())
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
            .sheet(isPresented: $showingAccount) {
                AccountView()
            }
    }

    /// Extracted from `body` for the type-checker's sake, same as `pages`.
    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.15)) {
                        showsCalendar.toggle()
                    }
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
                    .foregroundStyle(Theme.inkSecondary)
                }
                .accessibilityElement(children: .combine)
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
                    Button("Account", systemImage: "person.crop.circle") {
                        showingAccount = true
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
            ContentUnavailableView {
                Label("Couldn't load this week", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await model.start() } }
                    .buttonStyle(.primary)
                    .fixedSize()
            }
            .background(Theme.canvas)
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

    private func dayList(for index: Int) -> some View {
        let day = weekDays.indices.contains(index) ? weekDays[index] : nil
        return DayPage(day: day,
                       events: day.map(self.events(on:)) ?? [],
                       clashingIDs: model.clashingIDs,
                       highlight: { model.highlight(for: $0) },
                       skipped: Attendance.decode(skippedData),
                       isLoading: model.isLoading,
                       onSelect: { selectedEvent = $0 })
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
}

#if DEBUG
#Preview("Light") { PreviewScreen.day.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.day.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.day.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.day.view
}
#endif
