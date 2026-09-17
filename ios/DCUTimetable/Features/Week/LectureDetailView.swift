import SwiftUI

/// Everything known about one class, on its own page.
///
/// Three kinds of information share this screen, and they are deliberately kept visually
/// distinct because they carry different weight: what the university says (times, room,
/// staff), what other students say (cancellation reports, deadlines), and what this student
/// has decided (not attending).
struct LectureDetailView: View {
    let event: TimetableEvent
    let isClashing: Bool

    @StateObject private var model: LectureDetailViewModel
    @AppStorage(Attendance.storageKey) private var skippedData = Data()
    @State private var showingDeadlineForm = false

    init(event: TimetableEvent,
         isClashing: Bool,
         cancellations: CancellationStore = CancellationStoreFactory.make(),
         deadlines: DeadlineStore = DeadlineStoreFactory.make()) {
        self.event = event
        self.isClashing = isClashing
        _model = StateObject(wrappedValue: LectureDetailViewModel(event: event,
                                                                 cancellations: cancellations,
                                                                 deadlines: deadlines))
    }

    private var eventKey: String { CancellationRules.eventKey(for: event) }
    private var isSkipping: Bool { Attendance.decode(skippedData).contains(eventKey) }

    var body: some View {
        List {
            dueToday
            header
            details
            attendance
            cancellation
            deadlines
        }
        .listStyle(.grouped)
        .navigationTitle(event.moduleCode ?? "Class")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load() }
        .sheet(isPresented: $showingDeadlineForm) {
            DeadlineFormView { title, kind, due in
                Task { await model.addDeadline(title: title, kind: kind, due: due) }
            }
        }
    }

    // MARK: - Sections

    /// The very top of the page: what's due at this exact class today, and nothing else.
    @ViewBuilder
    private var dueToday: some View {
        if !model.dueHere.isEmpty {
            Section {
                ForEach(model.dueHere) { deadline in
                    HStack(spacing: 10) {
                        Image(systemName: deadline.kind.isSatInClass
                              ? "pencil.and.list.clipboard" : "doc.text")
                            .foregroundStyle(tint(for: deadline))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(deadline.kind.isSatInClass
                                 ? "\(deadline.kind.label) in this class"
                                 : "\(deadline.kind.label) due at this class")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(tint(for: deadline))
                            Text(deadline.title).font(.headline)
                            Text(deadline.due.formatted(date: .complete, time: .shortened))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    /// Same meaning, same colour as the border in the timetable.
    private func tint(for deadline: Deadline) -> Color {
        deadline.kind.isSatInClass ? TimetableTint.test : TimetableTint.due
    }

    private var header: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title).font(.title3.weight(.semibold))
                Text(event.groupLabel).font(.subheadline).foregroundStyle(.secondary)
                if isSkipping {
                    Label("You're not attending this", systemImage: "person.slash")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private var details: some View {
        Section("Class") {
            LabeledContent("Time", value: "\(event.start.formatted(date: .omitted, time: .shortened))–\(event.end.formatted(date: .omitted, time: .shortened))")
            LabeledContent("Date", value: event.start.formatted(.dateTime.weekday(.wide).day().month(.wide)))
            LabeledContent("Where", value: event.locationDisplay)
            LabeledContent("Delivery", value: event.type.label)
            if let code = event.moduleCode {
                LabeledContent("Module", value: code)
            }
            LabeledContent("Activity", value: event.activity.raw)
            if !event.weekLabels.isEmpty {
                LabeledContent("Weeks", value: event.weekLabels.joined(separator: ", "))
            }
            if isClashing {
                Label("Overlaps another class", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
        }

        Section("Taught by") {
            if model.lecturers.isEmpty {
                Text("No staff listed for this class").foregroundStyle(.secondary)
            } else {
                ForEach(model.lecturers) { lecturer in
                    LecturerRow(lecturer: lecturer)
                }
            }
        }
    }

    private var attendance: some View {
        Section {
            Toggle(isOn: Binding(
                get: { isSkipping },
                set: { _ in skippedData = Attendance.encode(Attendance.toggling(eventKey, in: Attendance.decode(skippedData))) }
            )) {
                Label("I won't attend this", systemImage: "person.slash")
            }
        } footer: {
            Text("Only you see this. It doesn't report the class as cancelled.")
        }
    }

    private var cancellation: some View {
        Section {
            if model.status.isFlagged {
                Label("Reported not on · \(model.status.reportCount) people",
                      systemImage: "exclamationmark.circle.fill")
                    .foregroundStyle(TimetableTint.off)
            } else if model.status.reportCount > 0 {
                Text("\(model.status.reportCount) of \(CancellationRules.threshold) people say this isn't on")
                    .foregroundStyle(.secondary)
            } else {
                Text("Nobody has reported this class as off").foregroundStyle(.secondary)
            }

            Button(role: model.status.reportedByMe ? nil : .destructive) {
                Task { await model.toggleReport() }
            } label: {
                Label(model.status.reportedByMe ? "Undo my report" : "Report: lecture not on",
                      systemImage: model.status.reportedByMe ? "arrow.uturn.backward" : "exclamationmark.bubble")
            }
            .disabled(model.isBusy)
        } header: {
            Text("Is it on?")
        } footer: {
            Text("Reports are anonymous. A class is flagged with an orange ! once \(CancellationRules.threshold) people report it.")
        }
    }

    private var deadlines: some View {
        Section {
            if model.isLoading && model.deadlines.isEmpty {
                ProgressView()
            } else if model.deadlines.isEmpty {
                Text("No deadlines shared for \(DeadlineRules.moduleKey(for: event)) yet")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.deadlines) { deadline in
                    DeadlineRow(deadline: deadline,
                                standing: model.standing(for: deadline),
                                isMine: model.isMine(deadline),
                                onConfirm: { Task { await model.toggleConfirmation(deadline) } },
                                onDelete: { Task { await model.removeDeadline(deadline) } })
                }
            }
            Button {
                showingDeadlineForm = true
            } label: {
                Label("Add a deadline", systemImage: "plus.circle")
            }
        } header: {
            Text("All \(DeadlineRules.moduleKey(for: event)) dates")
        } footer: {
            Text("Shared with everyone taking this module. Confirm the ones you know are right — a deadline is flagged as confirmed once \(DeadlineRules.confirmThreshold) people have vouched for it. You can only remove your own.")
        }
    }
}

// MARK: - Rows

private struct LecturerRow: View {
    let lecturer: Lecturer

    var body: some View {
        HStack(spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 1) {
                Text(lecturer.displayName)
                if let role = lecturer.role {
                    Text(role).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// A photo when one is known, initials otherwise — never an empty grey box.
    @ViewBuilder
    private var avatar: some View {
        if let url = lecturer.photoURL {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                initialsCircle
            }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
        } else {
            initialsCircle
        }
    }

    private var initialsCircle: some View {
        Circle()
            .fill(Color.accentColor.opacity(0.15))
            .frame(width: 36, height: 36)
            .overlay {
                Text(lecturer.initials)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
    }
}

private struct DeadlineRow: View {
    let deadline: Deadline
    let standing: DeadlineStanding
    let isMine: Bool
    let onConfirm: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Image(systemName: deadline.kind.symbol)
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(deadline.title)
                    Text("\(deadline.kind.label) · due \(deadline.due.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Text(DeadlineRules.countdown(to: deadline.due))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            // One unverified person's date is worth less than three people's, and the row
            // says which it is rather than presenting both the same way.
            HStack(spacing: 8) {
                Label(standing.summary,
                      systemImage: standing.isConfirmed ? "checkmark.seal.fill" : "questionmark.circle")
                    .font(.caption2)
                    .foregroundStyle(standing.isConfirmed ? TimetableTint.confirmed : .secondary)
                Spacer(minLength: 0)
                if !isMine {
                    Button(standing.confirmedByMe ? "Confirmed" : "This is right") { onConfirm() }
                        .font(.caption2)
                        .buttonStyle(.bordered)
                        .tint(standing.confirmedByMe ? TimetableTint.confirmed : .accentColor)
                }
            }
            .padding(.leading, 34)
        }
        .swipeActions {
            if isMine {
                Button("Delete", role: .destructive, action: onDelete)
            }
        }
    }
}

/// Adding a deadline. Kept to three fields — a title, what it is, and when it's due.
private struct DeadlineFormView: View {
    let onSubmit: (String, DeadlineKind, Date) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var kind: DeadlineKind = .assignment
    @State private var due = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("What's due?", text: $title)
                    Picker("Type", selection: $kind) {
                        ForEach(DeadlineKind.allCases, id: \.self) { kind in
                            Label(kind.label, systemImage: kind.symbol).tag(kind)
                        }
                    }
                    DatePicker("Due", selection: $due, in: Date()...)
                } footer: {
                    Text("Everyone taking this module will see this.")
                }
            }
            .listStyle(.grouped)
            .navigationTitle("Add a deadline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        onSubmit(title.trimmingCharacters(in: .whitespacesAndNewlines), kind, due)
                        dismiss()
                    }
                    .disabled(!DeadlineRules.isValid(title: title, due: due))
                }
            }
        }
    }
}
