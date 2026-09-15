import SwiftUI
import UniformTypeIdentifiers

/// First-launch profile creator: the student just types their name and taps Continue.
/// The match against the class list happens silently on the backend (no identity is shown
/// — verification / email sign-in will come later). Falls back to picking a programme.
struct ProfileCreatorView: View {
    let onCreate: (StudentProfile) -> Void
    let onChooseProgramme: () -> Void

    @State private var name = ""
    @State private var directoryAvailable = EngGroupDirectory.isAvailable
    @State private var showImporter = false
    @State private var errorText: String?

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Set up your timetable").font(.title2.weight(.bold))
                    Text("Enter your name and we'll build your timetable.")
                        .foregroundStyle(.secondary)
                }

                Section("Your name") {
                    TextField("Full name", text: $name)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .onSubmit(continueTapped)
                        .onChange(of: name) { _, _ in errorText = nil }
                }

                if let errorText {
                    Section {
                        Text(errorText).font(.callout).foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button(action: continueTapped) {
                        Text("Continue").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(trimmedName.isEmpty)
                }

                Section {
                    Button {
                        showImporter = true
                    } label: {
                        Label(directoryAvailable ? "Replace class list…" : "Import class list…",
                              systemImage: "square.and.arrow.down")
                    }
                    Button(action: onChooseProgramme) {
                        Label("Choose a programme instead", systemImage: "magnifyingglass")
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
        }
    }

    private func continueTapped() {
        guard !trimmedName.isEmpty else { return }

        // Look up every word typed (handles "Armstrong", "Luke Armstrong", "Armstrong Luke").
        let tokens = trimmedName.split(separator: " ").map(String.init)
        var matches: [EngGroupRecord] = []
        for token in tokens {
            for record in EngGroupDirectory.lookup(surname: token) where !matches.contains(record) {
                matches.append(record)
            }
        }

        guard !matches.isEmpty else {
            errorText = directoryAvailable
                ? "We couldn't find “\(trimmedName)”. Check the spelling of your surname, or choose a programme below."
                : "No class list is loaded yet — import one, or choose a programme below."
            return
        }

        // The list is surname-first and every name part is indexed, so a single word can
        // match several students. Prefer an exact full-name match; if it's still ambiguous
        // ask for the full name rather than silently assigning the wrong person's group.
        let typedParts = Set(trimmedName.lowercased().split(separator: " "))
        let exact = matches.first {
            Set($0.name.lowercased().split(separator: " ")) == typedParts
        }

        guard let record = exact ?? (matches.count == 1 ? matches.first : nil) else {
            errorText = "That matches more than one student — please enter your full name."
            return
        }

        onCreate(StudentProfile(name: record.name, group: record.group, subgroup: record.subgroup,
                                workshop: record.workshop, drawing: record.drawing))
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                _ = try EngGroupDirectory.importFile(at: url)
                directoryAvailable = true
                errorText = nil
            } catch {
                errorText = error.localizedDescription
            }
        case .failure(let error):
            errorText = error.localizedDescription
        }
    }
}
