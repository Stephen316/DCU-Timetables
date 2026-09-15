import SwiftUI

struct WeekView: View {
    let programme: TimetableCategory
    let onChangeProgramme: () -> Void

    @StateObject private var model: WeekViewModel
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @State private var showingGroups = false
    @State private var showingEngLabs = false

    init(programme: TimetableCategory, onChangeProgramme: @escaping () -> Void) {
        self.programme = programme
        self.onChangeProgramme = onChangeProgramme
        let hidden = HiddenGroups.decode(UserDefaults.standard.data(forKey: "hiddenGroups") ?? Data())
        _model = StateObject(wrappedValue: WeekViewModel(programme: programme, hiddenGroups: hidden))
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
            .navigationTitle(programme.code)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(programme.code).font(.headline)
                        Text(model.weekLabel).font(.caption).foregroundStyle(.secondary)
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
                        Button("Change programme", systemImage: "arrow.left.arrow.right",
                               action: onChangeProgramme)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .overlay { if model.isLoading && model.events.isEmpty { ProgressView() } }
            .task { await model.start() }
            .sheet(isPresented: $showingGroups) {
                GroupSelectionView(programme: programme)
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
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse").font(.caption2)
                    Text(event.locationText).font(.caption)
                    Text("· \(event.type.label)").font(.caption).foregroundStyle(.secondary)
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
