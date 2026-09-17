import SwiftUI
import UniformTypeIdentifiers

/// After sign-in the student's name comes from their verified DCU address, so there is
/// nothing to type — this just resolves that name to a lab group and creates the profile,
/// showing fallbacks only when the name isn't in the class list.
struct ProfileCreatorView: View {
    let user: AuthenticatedUser
    let onCreate: (StudentProfile) -> Void
    let onChooseProgramme: () -> Void
    let onSignOut: () -> Void

    private enum Status { case resolving, noList, notFound, ambiguous }

    @State private var status: Status = .resolving
    @State private var showImporter = false
    @State private var note: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Setting up your timetable").font(.title2.weight(.bold))
                    if let email = user.email {
                        Text("Signed in as \(email.displayName) · \(email.address)")
                            .foregroundStyle(.secondary)
                    }
                }

                switch status {
                case .resolving:
                    Section { ProgressView("Finding your group…") }
                case .noList:
                    Section {
                        Text("No class list has been imported yet, so your lab group can't be looked up.")
                            .foregroundStyle(.secondary)
                    }
                case .notFound:
                    Section {
                        Text("You're not in the imported class list, so we can't tell which lab group you're in. You can still pick your programme.")
                            .foregroundStyle(.secondary)
                    }
                case .ambiguous:
                    Section {
                        Text("More than one student matches that name — pick your programme instead.")
                            .foregroundStyle(.secondary)
                    }
                }

                if let note {
                    Section { Text(note).font(.caption).foregroundStyle(.secondary) }
                }

                if status != .resolving {
                    Section {
                        Button {
                            showImporter = true
                        } label: {
                            Label("Import class list…", systemImage: "square.and.arrow.down")
                        }
                        Button(action: onChooseProgramme) {
                            Label("Choose a programme instead", systemImage: "magnifyingglass")
                        }
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
            }
            .navigationTitle("Welcome")
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [.json, .commaSeparatedText, .plainText, .text, .data],
                allowsMultipleSelection: false
            ) { result in
                handleImport(result)
            }
            .task { resolve() }
        }
    }

    /// Match the name from the address against the class list. The list is surname-first
    /// ("Harcourt Stephen") while the address is given-name-first, so compare the parts as
    /// a set rather than in order.
    private func resolve() {
        guard EngGroupDirectory.isAvailable else { status = .noList; return }
        guard let email = user.email else { status = .notFound; return }

        var candidates: [EngGroupRecord] = []
        for part in email.nameParts {
            for record in EngGroupDirectory.lookup(surname: part) where !candidates.contains(record) {
                candidates.append(record)
            }
        }
        let wanted = Set(email.nameParts)
        let exact = candidates.filter { Set($0.name.lowercased().split(separator: " ").map(String.init)) == wanted }

        if let match = exact.first ?? (candidates.count == 1 ? candidates.first : nil) {
            onCreate(StudentProfile(name: match.name, group: match.group, subgroup: match.subgroup,
                                    workshop: match.workshop, drawing: match.drawing))
        } else {
            status = candidates.isEmpty ? .notFound : .ambiguous
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let count = try EngGroupDirectory.importFile(at: url)
                note = "Imported \(count) students."
                status = .resolving
                resolve()
            } catch {
                note = error.localizedDescription
            }
        case .failure(let error):
            note = error.localizedDescription
        }
    }
}
