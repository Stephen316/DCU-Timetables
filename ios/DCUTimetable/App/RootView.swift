import SwiftUI

/// Flow: sign in with a DCU address → the profile resolves from the name in that address
/// → timetable. "Choose a programme instead" covers anyone not in the class list.
struct RootView: View {
    @AppStorage("studentProfile") private var profileData = Data()
    @AppStorage("selectedProgramme") private var selectedProgrammeData = Data()
    @AppStorage("hiddenGroups") private var hiddenGroupsData = Data()
    @AppStorage("useProgrammePicker") private var useProgrammePicker = false
    @AppStorage(Attendance.storageKey) private var skippedData = Data()
    /// Class-list versions already asked about for a student on a picked programme — see
    /// `AllocationRefresh.adopt`.
    @AppStorage("allocationTried") private var allocationTriedData = Data()
    @State private var signedIn = SignedInUser.current
    @State private var refreshing = false
    @Environment(\.scenePhase) private var scenePhase

    private var profile: StudentProfile? {
        try? JSONDecoder().decode(StudentProfile.self, from: profileData)
    }
    private var selectedProgramme: TimetableCategory? {
        try? JSONDecoder().decode(TimetableCategory.self, from: selectedProgrammeData)
    }

    var body: some View {
        flow
            // A class list saved or corrected in the console bumps its version; a profile
            // made from the old one is resolved again rather than trusted, and a student on
            // a picked programme is looked up on the new list. On launch, sign-in and return
            // to the foreground — one version fetch when nothing has changed.
            .task(id: signedIn?.id) { await refreshAllocation() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refreshAllocation() } }
            }
            // The session can die while the app is open; when it does the student is no
            // longer signed in, whatever the last launch recorded.
            .onReceive(NotificationCenter.default
                .publisher(for: .authSessionExpired)
                .receive(on: RunLoop.main)) { _ in
                    signedIn = nil
                }
            .onReceive(NotificationCenter.default
                .publisher(for: .signOutRequested)
                .receive(on: RunLoop.main)) { _ in
                    signOut()
                }
    }

    @ViewBuilder
    private var flow: some View {
        if signedIn == nil {
            SignInView { user in signedIn = user }
        } else if let profile {
            TimetableShell(
                programme: TimetableCategory(identity: "profile-\(profile.group)",
                                             name: "Year 1 Engineering",
                                             categoryTypeIdentity: ""),
                source: ProfileTimetableSource(profile: profile),
                title: "Year 1 Eng",
                resetLabel: "Sign out"
            ) { signOut() }
        } else if let selectedProgramme {
            TimetableShell(programme: selectedProgramme, resetLabel: "Sign out") { signOut() }
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

    private func refreshAllocation() async {
        // Launch fires both the task and the foreground change.
        guard !refreshing, let user = signedIn, let store = AllocationStoreFactory.make() else { return }
        refreshing = true
        defer { refreshing = false }

        guard let profile else {
            guard selectedProgramme != nil else { return }
            let tried = (try? JSONDecoder().decode([String: Int].self, from: allocationTriedData)) ?? [:]
            switch await AllocationRefresh.adopt(name: user.email?.displayName ?? "", tried: tried, store: store) {
            case .adopted(let adopted):
                profileData = (try? JSONEncoder().encode(adopted)) ?? Data()
                selectedProgrammeData = Data()
                hiddenGroupsData = Data()
                allocationTriedData = Data()
            case .stay(let now):
                allocationTriedData = (try? JSONEncoder().encode(now)) ?? allocationTriedData
            }
            return
        }
        switch await AllocationRefresh.check(profile, store: store) {
        case .unchanged:
            break
        case .updated(let refreshed):
            profileData = (try? JSONEncoder().encode(refreshed)) ?? profileData
        case .dropped:
            profileData = Data()
            hiddenGroupsData = Data()
        }
    }

    /// Everything this student left on the device goes, not just their credentials — the
    /// next person to sign in here is a different person, and inheriting someone else's
    /// "I won't attend" marks or their anonymous voter id would be wrong twice over.
    private func signOut() {
        SignedInUser.signOut()
        ReporterID.reset()
        CachedRole.reset()
        signedIn = nil
        profileData = Data()
        selectedProgrammeData = Data()
        hiddenGroupsData = Data()
        skippedData = Data()
        allocationTriedData = Data()
        useProgrammePicker = false
    }
}
