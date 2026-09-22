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
    /// Non-nil while the "are you sure?" sheet is up, holding the side being reported.
    @State private var pendingReport: ReportStance?

    init(event: TimetableEvent,
         isClashing: Bool,
         knownDeadlines: [Deadline] = [],
         cancellations: CancellationStore = CancellationStoreFactory.make(),
         deadlines: DeadlineStore = DeadlineStoreFactory.make()) {
        self.event = event
        self.isClashing = isClashing
        _model = StateObject(wrappedValue: LectureDetailViewModel(event: event,
                                                                 cancellations: cancellations,
                                                                 deadlines: deadlines,
                                                                 known: knownDeadlines))
    }

    private var eventKey: String { CancellationRules.eventKey(for: event) }
    private var isSkipping: Bool { Attendance.decode(skippedData).contains(eventKey) }

    var body: some View {
        List {
            reportBanner
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
        .confirmationDialog(confirmTitle,
                            isPresented: Binding(get: { pendingReport != nil },
                                                 set: { if !$0 { pendingReport = nil } }),
                            titleVisibility: .visible) {
            if let stance = pendingReport {
                Button(confirmVerb(for: stance)) {
                    pendingReport = nil
                    Task { await model.report(stance) }
                }
                Button("Cancel", role: .cancel) { pendingReport = nil }
            }
        } message: {
            Text("Everyone taking this module sees the count. You can undo it afterwards.")
        }
    }

    private var confirmTitle: String {
        switch pendingReport {
        case .cancelled: return "Report this lecture as cancelled?"
        case .on:        return "Report that this lecture went ahead?"
        case nil:        return ""
        }
    }

    /// The confirm button repeats the action rather than saying "OK", so the sheet can be
    /// read on its own — which is the only bit of it a thumb-first tap actually sees.
    private func confirmVerb(for stance: ReportStance) -> String {
        stance == .cancelled ? "Report cancelled" : "Report it was on"
    }

    // MARK: - Sections

    /// What has been reported about this class, in orange, before anything else on the
    /// page.
    ///
    /// It repeats what the section further down already says, on purpose: a student opening
    /// this page ten minutes before a 9am has one question, and making them scroll past the
    /// room and the lecturer list to find the answer is the wrong order. Their own report
    /// leads, because "did I already do this?" is the other half of that question.
    @ViewBuilder
    private var reportBanner: some View {
        if !model.status.isDecided,
           model.status.myReportLine != nil || model.status.othersLine != nil {
            Section {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "exclamationmark.bubble.fill")
                        .font(.caption)
                    VStack(alignment: .leading, spacing: 2) {
                        if let mine = model.status.myReportLine {
                            Text(mine).font(.caption.weight(.semibold))
                        }
                        if let others = model.status.othersLine {
                            Text(others).font(.caption)
                        }
                        if let disputed = model.status.disputedLine {
                            Text(disputed).font(.caption)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(TimetableTint.off)
                .padding(.vertical, 2)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        }
    }

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
            standingRow

            if model.canDecide {
                decideButtons
            } else {
                reportButtons
            }

            // Every write on this page used to fail in silence: the view model recorded the
            // error and nothing ever read it, so a refused report looked exactly like a
            // working one.
            if let errorText = model.errorText {
                Label(errorText, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(TimetableTint.off)
            }
        } header: {
            Text("Is it on?")
        } footer: {
            if model.canDecide {
                Text("Your decision replaces the count for everyone straight away. "
                     + "Say it's on to clear a wrong report.")
            } else {
                Text("Reports are anonymous. A class is flagged with an orange ! once "
                     + "\(CancellationRules.threshold) people report it and they stay "
                     + "\(CancellationRules.netThreshold) ahead of anyone saying it went ahead.")
            }
        }
    }

    /// One row when this student hasn't voted, two once someone else has claimed the class
    /// is cancelled, and an undo once they have voted themselves.
    ///
    /// The "it was on" button only appears when there is a cancellation to contradict.
    /// Offering it on every class would invite a vote on the hundreds of lectures that ran
    /// exactly as timetabled, which is noise: silence already means that.
    @ViewBuilder
    private var reportButtons: some View {
        if model.status.myStance != nil {
            // No destructive role: taking back your own report isn't a delete, and red
            // read as one.
            Button {
                Task { await model.withdrawReport() }
            } label: {
                Label("Undo my report", systemImage: "arrow.uturn.backward")
            }
            .disabled(model.isBusy)
        } else {
            Button {
                pendingReport = .cancelled
            } label: {
                Label("Report: lecture cancelled", systemImage: "exclamationmark.bubble")
            }
            .disabled(model.isBusy)

            if model.status.reportCount > 0 {
                Button {
                    pendingReport = .on
                } label: {
                    Label("Report: lecture is on", systemImage: "checkmark.bubble")
                }
                .disabled(model.isBusy)
            }
        }
    }

    /// A stated verdict and a tally of guesses are different claims, so they are drawn
    /// differently: the verdict gets a filled badge and a source, the crowd stays plain.
    /// Collapsing the two would make one person's mistake look like a consensus.
    @ViewBuilder
    private var standingRow: some View {
        if let verdict = model.status.verdict {
            VStack(alignment: .leading, spacing: 4) {
                Label(verdict.headline, systemImage: symbol(for: verdict.state))
                    .foregroundStyle(verdict.state == .running ? Color.primary : TimetableTint.off)
                    .font(.body.weight(.semibold))
                if let note = verdict.note, !note.isEmpty {
                    Text(note).font(.callout).foregroundStyle(.secondary)
                }
                // The crowd is shown underneath rather than replaced: students disagreeing
                // with an organiser is worth seeing.
                if let crowd = model.status.crowdSummary {
                    Text(crowd).font(.caption).foregroundStyle(.secondary)
                }
            }
        } else if model.status.isFlagged {
            Label(model.status.summary, systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(TimetableTint.off)
        } else {
            Text(model.status.summary).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var decideButtons: some View {
        ForEach(VerdictState.allCases, id: \.self) { state in
            Button {
                Task { await model.decide(state) }
            } label: {
                Label(title(for: state), systemImage: symbol(for: state))
            }
            .disabled(model.isBusy || model.status.verdict?.state == state)
        }
    }

    private func title(for state: VerdictState) -> String {
        switch state {
        case .cancelled: return "Mark as cancelled"
        case .running:   return "Mark as on"
        case .moved:     return "Mark as moved"
        }
    }

    private func symbol(for state: VerdictState) -> String {
        switch state {
        case .cancelled: return "xmark.circle.fill"
        case .running:   return "checkmark.circle.fill"
        case .moved:     return "arrow.turn.up.right"
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
