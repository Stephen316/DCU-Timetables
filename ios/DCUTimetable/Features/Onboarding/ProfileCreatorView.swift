import SwiftUI

/// After sign-in the student's name comes from their verified DCU address, so there is
/// nothing to type. They pick their course, the server matches the address against that
/// course's class list (`resolve_allocation`), and the profile is created from the result.
///
/// The phone never sees the class list. It used to: the list was imported onto the device
/// and matched here, which put every classmate's name and lab allocation on every phone
/// that imported it. Matching now happens on the server and nowhere else.
struct ProfileCreatorView: View {
    let user: AuthenticatedUser
    let onCreate: (StudentProfile) -> Void
    let onChooseProgramme: () -> Void
    let onSignOut: () -> Void

    private enum Status: Equatable {
        case loading
        case chooseCourse([RosterSummary])
        case resolving
        case pickSubgroup(course: String, options: [String])
        case noList
        case notFound
        case conflict
        case failed(String)
    }

    @State private var status: Status = .loading
    private let store = AllocationStoreFactory.make()

    var body: some View {
        NavigationStack {
            List {
                Group {
                Section {
                    if let email = user.email {
                        Text("Signed in as \(email.displayName), \(email.address)")
                            .font(.subheadline)
                            .foregroundStyle(Theme.inkSecondary)
                            .bareRow()
                    }
                }

                switch status {
                case .loading, .resolving:
                    Section { ProgressView(status == .loading ? "Checking class lists…" : "Finding your group…") }
                case .chooseCourse(let rosters):
                    Section("Which course are you in?") {
                        ForEach(rosters) { roster in
                            Button(roster.title ?? roster.courseKey) {
                                Task { await resolve(roster.courseKey, subgroup: nil) }
                            }
                        }
                    }
                case .pickSubgroup(let course, let options):
                    Section {
                        Text("More than one student on the class list has your name. Which subgroup are you in?")
                            .foregroundStyle(Theme.inkSecondary)
                        ForEach(options, id: \.self) { option in
                            Button(option) {
                                Task { await resolve(course, subgroup: option) }
                            }
                        }
                    }
                case .noList:
                    Section {
                        Text("No class list has been uploaded for your course yet, so your lab group can't be looked up. You can still pick your programme.")
                            .foregroundStyle(Theme.inkSecondary)
                    }
                case .notFound:
                    Section {
                        Text("Your name isn't on the class list, so we can't tell which lab group you're in. You can still pick your programme.")
                            .foregroundStyle(Theme.inkSecondary)
                    }
                case .conflict:
                    Section {
                        Text("Your details don't match the class list cleanly, so it's been sent for a person to check. Pick your programme for now.")
                            .foregroundStyle(Theme.inkSecondary)
                    }
                case .failed(let message):
                    Section {
                        Text(message).foregroundStyle(Theme.inkSecondary)
                        Button("Try again") { Task { await load() } }
                    }
                }

                if status != .loading && status != .resolving {
                    Section {
                        Button(action: onChooseProgramme) {
                            Label("Choose a programme instead", systemImage: "magnifyingglass")
                        }
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                }
                .themedRows()
            }
            .listStyle(.grouped)
            .themedList()
            .navigationTitle("Your timetable")
            .adaptiveLargeTitle()
            .task { await load() }
        }
    }

    /// The class lists this app can build a timetable for. A list for any other course has
    /// no timetable here to put the student's labs into, so it isn't offered.
    private func load() async {
        guard let store else { status = .noList; return }
        status = .loading
        do {
            let usable = try await store.rosters().filter { StudentProfile.Cohort(courseKey: $0.courseKey) != nil }
            status = usable.isEmpty ? .noList : .chooseCourse(usable)
        } catch {
            status = .failed("Couldn't reach the server to look up your group. Check your connection.")
        }
    }

    private func resolve(_ courseKey: String, subgroup: String?) async {
        guard let store, let cohort = StudentProfile.Cohort(courseKey: courseKey) else { return }
        status = .resolving
        do {
            switch try await store.resolve(courseKey: courseKey, subgroup: subgroup) {
            case .matched(let key, let version):
                guard let allocation = try await store.allocation(courseKey: courseKey, key: key) else {
                    status = .notFound
                    return
                }
                onCreate(StudentProfile(name: user.email?.displayName ?? "", cohort: cohort,
                                        allocation: allocation, allocationKey: key, rosterVersion: version))
            case .ambiguous:
                // Asked once. A second ambiguous answer means the chosen subgroup didn't
                // separate them either, and asking again would not help.
                if subgroup == nil {
                    status = .pickSubgroup(course: courseKey, options: try await store.subgroups(courseKey: courseKey))
                } else {
                    status = .notFound
                }
            case .notListed: status = .notFound
            case .conflict: status = .conflict
            case .noRoster: status = .noList
            }
        } catch {
            status = .failed("Couldn't reach the server to look up your group. Check your connection.")
        }
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.profile.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.profile.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.profile.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.profile.view
}
#endif
