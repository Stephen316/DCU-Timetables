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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.canvas)
        } else if model.isEmpty {
            empty
        } else {
            list
        }
    }

    private var list: some View {
        List {
            Group {
            if let errorText = model.errorText {
                Section {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
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
            .themedRows()
        }
        .listStyle(.grouped)
        .themedList()
        .safeAreaInset(edge: .bottom) { summary }
    }

    /// The count is the point of the tab, so it stays on screen while the list scrolls.
    private var summary: some View {
        HStack(spacing: Theme.Space.l) {
            Text("\(model.total) upcoming")
            if model.testCount > 0 {
                Label("\(model.testCount) sat in class", systemImage: "pencil.and.list.clipboard")
                    .foregroundStyle(TimetableTint.test)
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.inkSecondary)
        .padding(.horizontal, Theme.Space.l)
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
        .background(Theme.canvas)
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
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            AdaptiveStack(spacing: Theme.Space.m) {
                Image(systemName: deadline.kind.symbol)
                    .foregroundStyle(tint)
                    .frame(width: 22)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    Text(deadline.title).font(.headline).foregroundStyle(Theme.ink)
                    Text("\(deadline.moduleKey) \(deadline.kind.label.lowercased())")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                    Text(deadline.due.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)
                                                    .hour().minute()))
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                // Wraps instead of truncating once the row has stacked at large text sizes.
                .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                Text(DeadlineRules.countdown(to: deadline.due))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.inkSecondary)
            }

            AdaptiveStack {
                Label(standing.summary,
                      systemImage: standing.isConfirmed ? "checkmark.seal.fill" : "questionmark.circle")
                    .font(.caption2)
                    .foregroundStyle(standing.isConfirmed ? TimetableTint.confirmed : Theme.inkSecondary)
                Spacer(minLength: 0)
                if !isMine {
                    Button(standing.confirmedByMe ? "Confirmed" : "This is right") { onConfirm() }
                        .buttonStyle(.inlineAction(tint: standing.confirmedByMe
                                                   ? TimetableTint.confirmed : Theme.accent))
                }
            }
            .modifier(HangingIndent())
        }
        .padding(.vertical, Theme.Space.xxs)
        .swipeActions {
            if isMine {
                Button("Delete", role: .destructive, action: onDelete)
            }
        }
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.deadlines.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.deadlines.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.deadlines.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.deadlines.view
}
#endif
