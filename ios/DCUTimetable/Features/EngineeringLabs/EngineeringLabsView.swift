import SwiftUI

/// Year-1 Engineering lab rotation. The public timetable only shows generic lab slots;
/// this uses the School's published rotation to show a student their exact labs for their
/// group — the one their profile was matched to, or one they pick.
///
/// There is no name lookup here any more. It used to search a class list imported onto the
/// phone; matching now happens on the server, once, when the profile is made.
struct EngineeringLabsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("engLabGroup") private var group = ""
    @AppStorage("studentProfile") private var profileData = Data()

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
            .themedList()
            .navigationTitle("Engineering labs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .onAppear {
                // The profile's group is the matched one; start there unless the student has
                // already picked something else on this screen.
                if group.isEmpty,
                   let profile = try? JSONDecoder().decode(StudentProfile.self, from: profileData) {
                    group = profile.group
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ rotation: LabRotation) -> some View {
        List {
            Group {
            Section("Your group") {
                Picker("Group", selection: $group) {
                    Text("—").tag("")
                    ForEach(rotation.groupLetters, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            if group.isEmpty {
                Section {
                    Text("Pick your group to see your personal lab schedule for the semester.")
                        .foregroundStyle(Theme.inkSecondary)
                }
            } else {
                let byWeek = Dictionary(grouping: rotation.sessions(forGroup: group), by: \.week)
                if byWeek.isEmpty {
                    Section { Text("No labs scheduled for Group \(group).").foregroundStyle(Theme.inkSecondary) }
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
            .themedRows()
        }
    }

    private func labRow(_ session: LabSession, _ rotation: LabRotation) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(shortTime(session.start)).font(.subheadline).monospacedDigit()
                Text(shortTime(session.end)).font(.caption).foregroundStyle(Theme.inkSecondary).monospacedDigit()
            }
            .frame(width: 56, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.activity).font(.headline).foregroundStyle(Theme.ink)
                Text("\(session.module) · \(rotation.name(for: session.module))")
                    .font(.caption).foregroundStyle(Theme.inkSecondary)
                Text(prettyDate(session)).font(.caption2).foregroundStyle(Theme.inkSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
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

#if DEBUG
#Preview("Light") { PreviewScreen.labs.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.labs.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.labs.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.labs.view
}
#endif
