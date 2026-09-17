import Foundation

@MainActor
final class LectureDetailViewModel: ObservableObject {
    @Published private(set) var status = CancellationStatus(reportCount: 0, reportedByMe: false)
    @Published private(set) var deadlines: [Deadline] = []
    @Published private(set) var standings: [String: DeadlineStanding] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var isBusy = false
    @Published var errorText: String?

    let lecturers: [Lecturer]

    private let event: TimetableEvent
    private let cancellations: CancellationStore
    private let deadlineStore: DeadlineStore
    private let reporterID = ReporterID.current

    /// Everything due at *this* class today — the banner at the top of the page. Other
    /// classes in the module list these at the bottom but don't lead with them.
    var dueHere: [Deadline] {
        DeadlineRules.due(at: event, from: deadlines)
    }

    private var eventKey: String { CancellationRules.eventKey(for: event) }
    private var moduleKey: String { DeadlineRules.moduleKey(for: event) }

    init(event: TimetableEvent,
         cancellations: CancellationStore,
         deadlines: DeadlineStore,
         known: [Deadline] = []) {
        self.event = event
        self.cancellations = cancellations
        self.deadlineStore = deadlines
        self.lecturers = LecturerDirectory.lecturers(for: event)
        // Seeded from the timetable's own copy so the page opens with its banner already
        // drawn; `load()` then replaces it with the authoritative list.
        self.deadlines = DeadlineRules.upcoming(
            known.filter { $0.moduleKey == DeadlineRules.moduleKey(for: event) })
    }

    func isMine(_ deadline: Deadline) -> Bool { deadline.submitterID == reporterID }

    /// The deadlines shown at the bottom keep every class in the module, including ones
    /// pinned elsewhere — `upcoming` only drops what's already past.
    func load() async {
        isLoading = true
        defer { isLoading = false }
        if let reports = try? await cancellations.reports(forKeys: [eventKey]) {
            status = CancellationRules.status(forKey: eventKey, reports: reports, reporterID: reporterID)
        }
        if let shared = try? await deadlineStore.deadlines(forModule: moduleKey) {
            deadlines = DeadlineRules.upcoming(shared)
            if let confirmations = try? await deadlineStore.confirmations(forDeadlineIDs: deadlines.map(\.id)) {
                standings = DeadlineRules.standings(from: confirmations, confirmerID: reporterID)
            }
        }
    }

    func standing(for deadline: Deadline) -> DeadlineStanding {
        standings[deadline.id] ?? DeadlineStanding(confirmCount: 0, confirmedByMe: false)
    }

    /// Vouching for someone else's deadline, or taking that back.
    func toggleConfirmation(_ deadline: Deadline) async {
        isBusy = true
        defer { isBusy = false }
        do {
            if standing(for: deadline).confirmedByMe {
                try await deadlineStore.unconfirm(deadlineID: deadline.id, confirmerID: reporterID)
            } else {
                try await deadlineStore.confirm(deadlineID: deadline.id, confirmerID: reporterID)
            }
            await load()
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't send that."
        }
    }

    func toggleReport() async {
        isBusy = true
        defer { isBusy = false }
        do {
            if status.reportedByMe {
                try await cancellations.withdraw(eventKey: eventKey, reporterID: reporterID)
            } else {
                try await cancellations.submit(CancellationReport(eventKey: eventKey, reporterID: reporterID))
            }
            await load()
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't send that report."
        }
    }

    func addDeadline(title: String, kind: DeadlineKind, due: Date) async {
        guard DeadlineRules.isValid(title: title, due: due) else { return }
        // Pinned to this class, so only this lecture or practical leads with it — a lab
        // report due at Thursday's practical shouldn't headline Monday's lecture.
        let deadline = Deadline(moduleKey: moduleKey, atGroupKey: event.groupKey,
                                title: title, due: due, kind: kind, submitterID: reporterID)
        // Show it straight away; the reload confirms it landed.
        deadlines = DeadlineRules.upcoming(deadlines + [deadline])
        do {
            try await deadlineStore.submit(deadline)
            // Submitting is itself a vouch — otherwise a deadline nobody has seen yet would
            // read as "0 people confirmed", which undersells a first-hand report.
            try? await deadlineStore.confirm(deadlineID: deadline.id, confirmerID: reporterID)
            await load()
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't share that deadline."
            await load()
        }
    }

    func removeDeadline(_ deadline: Deadline) async {
        guard isMine(deadline) else { return }
        deadlines.removeAll { $0.id == deadline.id }
        do {
            try await deadlineStore.withdraw(id: deadline.id, submitterID: reporterID)
        } catch {
            // Say so rather than letting the reload quietly put the row back, which looks
            // like the delete was ignored.
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't remove that deadline."
        }
        await load()
    }
}
