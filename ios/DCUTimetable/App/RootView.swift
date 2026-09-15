import SwiftUI

/// Shows onboarding until a programme is chosen, then the week view.
struct RootView: View {
    @AppStorage("selectedProgramme") private var selectedProgrammeData = Data()
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()

    private var selected: TimetableCategory? {
        try? JSONDecoder().decode(TimetableCategory.self, from: selectedProgrammeData)
    }

    var body: some View {
        if let selected {
            WeekView(programme: selected) {
                selectedProgrammeData = Data()
                hiddenGroupsData = Data()          // group choices are per programme
            }
        } else {
            ProgrammePickerView { category in
                selectedProgrammeData = (try? JSONEncoder().encode(category)) ?? Data()
                hiddenGroupsData = Data()
            }
        }
    }
}
