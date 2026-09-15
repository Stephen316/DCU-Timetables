import SwiftUI

/// Lets a student turn off the lab/tutorial groups they don't attend, so the timetable
/// and clash detection reflect only their own classes. Groups come straight from the
/// programme's live timetable (see docs — the public API's granularity is L/T/P groups
/// and surname splits; finer department allocations aren't exposed here).
struct GroupSelectionView: View {
    let programme: TimetableCategory
    var source: TimetableSource = DCUAPIClient()

    @Environment(\.dismiss) private var dismiss
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()

    @State private var modules: [ModuleGroups] = []
    @State private var isLoading = true
    @State private var errorText: String?

    private var hidden: Set<String> { HiddenGroups.decode(hiddenGroupsData) }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading your modules…")
                } else if let errorText {
                    ContentUnavailableView("Couldn't load groups", systemImage: "wifi.exclamationmark",
                                           description: Text(errorText))
                } else if modules.isEmpty {
                    ContentUnavailableView("No groups found", systemImage: "person.2",
                                           description: Text("This programme has no scheduled classes yet."))
                } else {
                    List {
                        Section {
                            Text("Turn off the lab/tutorial streams you're not in. What's left is your personal timetable — clash detection uses only these.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(modules) { module in
                            Section(header: Text("\(module.moduleCode) · \(module.moduleName)")) {
                                ForEach(module.groups) { option in
                                    Toggle(isOn: binding(for: option.key)) {
                                        Text(option.label)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Your groups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !modules.isEmpty && !hidden.isEmpty {
                        Button("Reset") { hiddenGroupsData = Data() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .task { await load() }
        }
    }

    private func binding(for key: String) -> Binding<Bool> {
        Binding(
            get: { !hidden.contains(key) },
            set: { isOn in
                var updated = hidden
                if isOn { updated.remove(key) } else { updated.insert(key) }
                hiddenGroupsData = HiddenGroups.encode(updated)
            }
        )
    }

    private func load() async {
        isLoading = true
        errorText = nil
        defer { isLoading = false }
        do {
            let calendar = try await source.weekCalendar()
            let events = try await source.events(for: programme, weeks: calendar.weeks)
            modules = GroupCatalog.modules(from: events)
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Please try again."
        }
    }
}
