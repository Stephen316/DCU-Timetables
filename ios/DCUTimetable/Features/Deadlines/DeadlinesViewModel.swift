import Foundation

/// Every shared date across every module the student takes, for the deadlines tab.
///
/// Reads the same store as the class pages, so a deadline added from a lecture appears here
/// and a confirmation given here counts on the lecture's page.
@MainActor
final class DeadlinesViewModel: ObservableObject {
    @Published private(set) var sections: [(section: DeadlineSection, deadlines: [Deadline])] = []
    @Published private(set) var standings: [String: DeadlineStanding] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published var errorText: String?

    private let store: DeadlineStore
    private let reporterID = ReporterID.current
    private var modules: [String] = []

    init(store: DeadlineStore) {
        self.store = store
    }

    var isEmpty: Bool { sections.isEmpty }

    /// How many of what's listed is sat in a room rather than handed in — worth saying out
    /// loud, because it's the half that can't be made up afterwards.
    var testCount: Int {
        DeadlineSchedule.sitInClass(sections.flatMap(\.deadlines)).count
    }

    var total: Int { sections.reduce(0) { $0 + $1.deadlines.count } }

    func isMine(_ deadline: Deadline) -> Bool { deadline.belongsTo(reporterID) }

    func standing(for deadline: Deadline) -> DeadlineStanding {
        standings[deadline.id] ?? DeadlineStanding(confirmCount: 0, confirmedByMe: false)
    }

    /// `modules` comes from the timetable, so this is cheap to call whenever the tab
    /// appears — the set only changes when a new week finishes loading.
    func load(modules: [String]) async {
        self.modules = modules
        guard !modules.isEmpty else {
            sections = []
            hasLoaded = true
            return
        }
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let all = try await store.deadlines(forModules: modules)
            sections = DeadlineSchedule.grouped(all)
            standings = try await store.standings(forDeadlineIDs: all.map(\.id))
            errorText = nil
        } catch {
            // Keep whatever is already on screen: a stale list beats an empty one when the
            // only thing that's wrong is the network.
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't load deadlines."
        }
    }

    func reload() async { await load(modules: modules) }

    func toggleConfirmation(_ deadline: Deadline) async {
        do {
            if standing(for: deadline).confirmedByMe {
                try await store.unconfirm(deadlineID: deadline.id, confirmerID: reporterID)
            } else {
                try await store.confirm(deadlineID: deadline.id, confirmerID: reporterID)
            }
            await reload()
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't send that."
        }
    }

    func remove(_ deadline: Deadline) async {
        guard isMine(deadline) else { return }
        do {
            try await store.withdraw(id: deadline.id, submitterID: reporterID)
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't remove that deadline."
        }
        await reload()
    }

    /// Hidden from this student by the server from now on, so a reload is all that's
    /// needed to take it off the list.
    func report(_ deadline: Deadline, reason: DeadlineReportReason) async {
        guard !isMine(deadline) else { return }
        do {
            try await store.report(deadlineID: deadline.id, reason: reason)
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't send that report."
        }
        await reload()
    }

    func hideAuthor(of deadline: Deadline) async {
        guard !isMine(deadline) else { return }
        do {
            try await store.hideAuthor(ofDeadlineID: deadline.id)
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't hide that person."
        }
        await reload()
    }
}
