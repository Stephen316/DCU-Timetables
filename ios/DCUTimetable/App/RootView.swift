import SwiftUI

/// Onboarding flow:
/// 1. no profile & not picking a programme → profile creator (enter name)
/// 2. profile created → Year-1 Engineering timetable built from the profile
/// 3. "choose a programme instead" → programme search → programme timetable
struct RootView: View {
    @AppStorage("studentProfile") private var profileData = Data()
    @AppStorage("selectedProgramme") private var selectedProgrammeData = Data()
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @AppStorage("useProgrammePicker") private var useProgrammePicker = false

    private var profile: StudentProfile? {
        try? JSONDecoder().decode(StudentProfile.self, from: profileData)
    }
    private var selectedProgramme: TimetableCategory? {
        try? JSONDecoder().decode(TimetableCategory.self, from: selectedProgrammeData)
    }

    var body: some View {
        if let profile {
            WeekView(
                programme: TimetableCategory(identity: "profile-\(profile.group)",
                                             name: "Year 1 Engineering",
                                             categoryTypeIdentity: ""),
                source: ProfileTimetableSource(profile: profile),
                title: "Year 1 Eng",
                resetLabel: "Edit profile"
            ) {
                profileData = Data()
                hiddenGroupsData = Data()
            }
        } else if let selectedProgramme {
            WeekView(programme: selectedProgramme, resetLabel: "Change programme") {
                selectedProgrammeData = Data()
                hiddenGroupsData = Data()
            }
        } else if useProgrammePicker {
            ProgrammePickerView { category in
                selectedProgrammeData = (try? JSONEncoder().encode(category)) ?? Data()
                hiddenGroupsData = Data()
                useProgrammePicker = false
            }
        } else {
            ProfileCreatorView(
                onCreate: { profile in
                    profileData = (try? JSONEncoder().encode(profile)) ?? Data()
                    hiddenGroupsData = Data()
                },
                onChooseProgramme: { useProgrammePicker = true }
            )
        }
    }
}
