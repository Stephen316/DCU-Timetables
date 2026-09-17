import SwiftUI
import UniformTypeIdentifiers

/// Year-1 Engineering lab rotation. The public timetable only shows generic lab slots;
/// this uses the School's published rotation to show a student their exact labs once they
/// pick their group (A–E) — or auto-detects the group from an imported class list by surname.
struct EngineeringLabsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("engLabGroup") private var group = ""

    @State private var surname = ""
    @State private var lookupMessage: String?
    @State private var directoryAvailable = EngGroupDirectory.isAvailable
    @State private var showImporter = false
    @State private var importMessage: String?

    private let rotation = LabRotationLoader.bundled()

    var body: some View {
        NavigationStack {
            Group {
                if let rotation {
                    content(rotation)
                } else {
                    ContentUnavailableView("Rotation unavailable", systemImage: "wrench.and.screwdriver")
                }
            }
            .listStyle(.grouped)
            .navigationTitle("Engineering labs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [.json, .commaSeparatedText, .plainText, .text, .data],
                allowsMultipleSelection: false
            ) { result in
                handleImport(result)
            }
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        lookupMessage = nil
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let count = try EngGroupDirectory.importFile(at: url)
                directoryAvailable = true
                importMessage = "Imported \(count) students. Type your surname above to find your group."
            } catch {
                importMessage = error.localizedDescription
            }
        case .failure(let error):
            importMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private func content(_ rotation: LabRotation) -> some View {
        List {
            Section("Your group") {
                Picker("Group", selection: $group) {
                    Text("—").tag("")
                    ForEach(rotation.groupLetters, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)

                if directoryAvailable {
                    HStack {
                        TextField("Find by surname", text: $surname)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.words)
                            .onSubmit(findBySurname)
                        Button("Find", action: findBySurname)
                            .buttonStyle(.borderedProminent)
                            .buttonBorderShape(.roundedRectangle(radius: 6))
                            .controlSize(.small)
                    }
                }
                if let lookupMessage {
                    Text(lookupMessage).font(.caption).foregroundStyle(.secondary)
                }

                Button {
                    showImporter = true
                } label: {
                    Label(directoryAvailable ? "Replace class list…" : "Import class list…",
                          systemImage: "square.and.arrow.down")
                }
                if !directoryAvailable {
                    Text("Import your class list (a Markdown/CSV table with Surname, Group, … columns) to auto-fill your group by name.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let importMessage {
                    Text(importMessage).font(.caption).foregroundStyle(.secondary)
                }
            }

            if group.isEmpty {
                Section {
                    Text("Pick your group to see your personal lab schedule for the semester.")
                        .foregroundStyle(.secondary)
                }
            } else {
                let byWeek = Dictionary(grouping: rotation.sessions(forGroup: group), by: \.week)
                if byWeek.isEmpty {
                    Section { Text("No labs scheduled for Group \(group).").foregroundStyle(.secondary) }
                }
                ForEach(byWeek.keys.sorted(), id: \.self) { week in
                    Section("Week \(week)") {
                        ForEach(byWeek[week] ?? []) { session in
                            labRow(session, rotation)
                        }
                    }
                }
            }
        }
    }

    private func labRow(_ session: LabSession, _ rotation: LabRotation) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(shortTime(session.start)).font(.subheadline).monospacedDigit()
                Text(shortTime(session.end)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            .frame(width: 56, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(rotation.activity(for: session.module)).font(.headline)
                Text("\(session.module) · \(rotation.name(for: session.module))")
                    .font(.caption).foregroundStyle(.secondary)
                Text(prettyDate(session)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }

    private func findBySurname() {
        let matches = EngGroupDirectory.lookup(surname: surname)
        guard let first = matches.first else {
            lookupMessage = "No match for “\(surname)”. Pick your group manually."
            return
        }
        group = first.group
        var msg = "\(first.name) → Group \(first.group) (\(first.subgroup)) · workshop \(first.workshop) · drawing \(first.drawing)"
        if matches.count > 1 { msg += " · \(matches.count) people share this surname — check it's you." }
        lookupMessage = msg
    }

    private func shortTime(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]) else { return hhmm }
        let suffix = h < 12 ? "am" : "pm"
        let h12 = h % 12 == 0 ? 12 : h % 12
        return parts[1] == "00" ? "\(h12)\(suffix)" : "\(h12):\(parts[1])\(suffix)"
    }

    private func prettyDate(_ session: LabSession) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_IE")
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: session.date) else { return "\(session.day) \(session.date)" }
        f.dateFormat = "EEEE d MMM"
        return f.string(from: date)
    }
}
