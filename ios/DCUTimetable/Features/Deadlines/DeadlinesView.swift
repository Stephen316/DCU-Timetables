import SwiftUI

/// Every assignment, quiz and exam the student's modules have, soonest first.
///
/// The timetable answers "where am I at 11?"; this answers "what's coming?". Same data,
/// same store — a date added on a lecture's page shows up here, and confirming here counts
/// there.
struct DeadlinesView: View {
    /// Modules to ask about, from the timetable that's already loaded.
    let modules: [String]

    @StateObject private var model: DeadlinesViewModel

    init(modules: [String], store: DeadlineStore) {
        self.modules = modules
        _model = StateObject(wrappedValue: DeadlinesViewModel(store: store))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Deadlines")
                .navigationBarTitleDisplayMode(.inline)
                .task { await model.load(modules: modules) }
                .onChange(of: modules) { _, updated in
                    Task { await model.load(modules: updated) }
                }
                .refreshable { await model.reload() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.isEmpty && model.isLoading {
            ProgressView()
        } else if model.isEmpty {
            empty
        } else {
            list
        }
    }

    private var list: some View {
        List {
            if let errorText = model.errorText {
                Section {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            ForEach(model.sections, id: \.section) { group in
                Section(group.section.title) {
                    ForEach(group.deadlines) { deadline in
                        ScheduleRow(deadline: deadline,
                                    standing: model.standing(for: deadline),
                                    isMine: model.isMine(deadline),
                                    onConfirm: { Task { await model.toggleConfirmation(deadline) } },
                                    onDelete: { Task { await model.remove(deadline) } })
                    }
                }
            }
        }
        .listStyle(.grouped)
        .safeAreaInset(edge: .bottom) { summary }
    }

    /// The count is the point of the tab, so it stays on screen while the list scrolls.
    private var summary: some View {
        HStack(spacing: 6) {
            Text("\(model.total) upcoming")
            if model.testCount > 0 {
                Text("·")
                Label("\(model.testCount) sat in class", systemImage: "pencil.and.list.clipboard")
                    .foregroundStyle(TimetableTint.test)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var empty: some View {
        ContentUnavailableView {
            Label("Nothing due", systemImage: "checkmark.circle")
        } description: {
            Text(modules.isEmpty
                 ? "Once your timetable loads, deadlines your classmates share will appear here."
                 : "Nobody has shared an assignment, quiz or exam for your modules yet. Open a class and add the first one.")
        }
    }
}

// MARK: - Row

/// One date. Shows which module it belongs to, because outside its own class page that is
/// the first thing you need to know.
private struct ScheduleRow: View {
    let deadline: Deadline
    let standing: DeadlineStanding
    let isMine: Bool
    let onConfirm: () -> Void
    let onDelete: () -> Void

    private var tint: Color {
        deadline.kind.isSatInClass ? TimetableTint.test : TimetableTint.due
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: deadline.kind.symbol)
                    .foregroundStyle(tint)
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 2) {
                    Text(deadline.title).font(.headline)
                    Text("\(deadline.moduleKey) · \(deadline.kind.label)")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(deadline.due.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)
                                                    .hour().minute()))
                        .font(.caption).foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)

                Text(DeadlineRules.countdown(to: deadline.due))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

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
                        .buttonBorderShape(.roundedRectangle(radius: 6))
                        .tint(standing.confirmedByMe ? TimetableTint.confirmed : .accentColor)
                }
            }
            .padding(.leading, 34)
        }
        .padding(.vertical, 2)
        .swipeActions {
            if isMine {
                Button("Delete", role: .destructive, action: onDelete)
            }
        }
    }
}
