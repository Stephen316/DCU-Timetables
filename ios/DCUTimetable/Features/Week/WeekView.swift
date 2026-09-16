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
                    List {
                        ForEach(model.eventsByDay, id: \.day) { group in
                            Section(dayHeader(group.day)) {
                                ForEach(group.events) { event in
                                    EventRow(event: event,
                                             isClashing: model.clashingIDs.contains(event.id))
                                }
                            }
                        }
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
            .onChange(of: hiddenGroupsData) { _, newValue in
                model.updateHiddenGroups(HiddenGroups.decode(newValue))
            }
        }
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
