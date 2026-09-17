import SwiftUI

/// Flow: sign in with a DCU address → the profile resolves from the name in that address
/// → timetable. "Choose a programme instead" covers anyone not in the class list.
struct RootView: View {
    @AppStorage("studentProfile") private var profileData = Data()
    @AppStorage("selectedProgramme") private var selectedProgrammeData = Data()
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @AppStorage("useProgrammePicker") private var useProgrammePicker = false
    @AppStorage(Attendance.storageKey) private var skippedData = Data()
    @State private var signedIn = SignedInUser.current

    private var profile: StudentProfile? {
        try? JSONDecoder().decode(StudentProfile.self, from: profileData)
    }
    private var selectedProgramme: TimetableCategory? {
        try? JSONDecoder().decode(TimetableCategory.self, from: selectedProgrammeData)
    }

    var body: some View {
        flow
            // The session can die while the app is open; when it does the student is no
            // longer signed in, whatever the last launch recorded.
            .onReceive(NotificationCenter.default
                .publisher(for: .authSessionExpired)
                .receive(on: RunLoop.main)) { _ in
                    signedIn = nil
                }
    }

    @ViewBuilder
    private var flow: some View {
        if signedIn == nil {
            SignInView { user in signedIn = user }
        } else if let profile {
            WeekView(
                programme: TimetableCategory(identity: "profile-\(profile.group)",
                                             name: "Year 1 Engineering",
                                             categoryTypeIdentity: ""),
                source: ProfileTimetableSource(profile: profile),
                title: "Year 1 Eng",
                resetLabel: "Sign out"
            ) { signOut() }
        } else if let selectedProgramme {
            WeekView(programme: selectedProgramme, resetLabel: "Sign out") { signOut() }
        } else if useProgrammePicker {
            ProgrammePickerView { category in
                selectedProgrammeData = (try? JSONEncoder().encode(category)) ?? Data()
                hiddenGroupsData = Data()
                useProgrammePicker = false
            }
        } else if let user = signedIn {
            ProfileCreatorView(
                user: user,
                onCreate: { profile in
                    profileData = (try? JSONEncoder().encode(profile)) ?? Data()
                    hiddenGroupsData = Data()
                },
                onChooseProgramme: { useProgrammePicker = true },
                onSignOut: { signOut() }
            )
        }
    }

    /// Everything this student left on the device goes, not just their credentials — the
    /// next person to sign in here is a different person, and inheriting someone else's
    /// "I won't attend" marks or their anonymous voter id would be wrong twice over.
    private func signOut() {
        SignedInUser.signOut()
        ReporterID.reset()
        signedIn = nil
        profileData = Data()
        selectedProgrammeData = Data()
        hiddenGroupsData = Data()
        skippedData = Data()
        useProgrammePicker = false
    }
}
