import Foundation
import SwiftUI

@MainActor
final class WeekViewModel: ObservableObject {
    @Published var events: [TimetableEvent] = []          // current week, filtered to groups
    @Published var clashingIDs: Set<String> = []
    @Published var isLoading = false
    @Published var errorText: String?
    @Published var weekLabel: String = ""
    @Published var hasEngineeringLabs = false
    /// Monday of the week being shown, so the day view can lay out Mon–Fri.
    @Published private(set) var weekStart: Date?
    /// Position in `weeks`. Bound directly to the calendar pager.
    @Published var weekIndex = 0
    /// Filtered events keyed by week number, for the weeks the pager can reach.
    @Published private(set) var eventsByWeekNumber: [Int: [TimetableEvent]] = [:]

    private(set) var weeks: [TeachingWeek] = []
    /// Crowd-sourced "not on" tallies for the visible week, keyed by event key.
    @Published private(set) var cancellations: [String: CancellationStatus] = [:]
    /// Deadlines for every module on screen, so a class can be outlined on the day one falls.
    @Published private(set) var deadlines: [Deadline] = []
    /// `moduleKeys` as of the last load, published so the deadlines tab can watch it.
    @Published private(set) var loadedModuleKeys: [String] = []

    let programme: TimetableCategory
    private let source: TimetableSource
    private let cache: TimetableCache

    private var rawByWeekNumber: [Int: [TimetableEvent]] = [:]
    private var hiddenGroups: Set<String>
    /// Handed to the class page so it talks to the same stores rather than making its own.
    let cancellationStore: CancellationStore
    let deadlineStore: DeadlineStore
    private let reporterID = ReporterID.current
    private let engLabModules = LabRotationLoader.bundled()?.moduleCodes ?? []

    init(programme: TimetableCategory,
         hiddenGroups: Set<String> = [],
         source: TimetableSource = DCUAPIClient(),
         cache: TimetableCache = TimetableCache(),
         cancellationStore: CancellationStore = CancellationStoreFactory.make(),
         deadlineStore: DeadlineStore = DeadlineStoreFactory.make()) {
        self.programme = programme
        self.hiddenGroups = hiddenGroups
        self.source = source
        self.cache = cache
        self.cancellationStore = cancellationStore
        self.deadlineStore = deadlineStore
    }

    // MARK: - Cancellation reports

    func status(for event: TimetableEvent) -> CancellationStatus {
        cancellations[CancellationRules.eventKey(for: event)]
            ?? CancellationStatus(reportCount: 0, reportedByMe: false)
    }

    /// Non-fatal: a reporting outage must never stop the timetable itself showing.
    func refreshCancellations() async {
        let keys = events.map { CancellationRules.eventKey(for: $0) }
        guard !keys.isEmpty else {
            cancellations = [:]
            return
        }
        guard let reports = try? await cancellationStore.reports(forKeys: keys) else { return }
        cancellations = CancellationRules.statuses(from: reports, reporterID: reporterID)
    }

    /// What (if anything) to outline a class with: not running, a quiz today, or something
    /// due today.
    func highlight(for event: TimetableEvent) -> ClassHighlight? {
        DeadlineRules.highlight(for: event, deadlines: deadlines, cancellation: status(for: event))
    }

    /// Non-fatal, like the reports: no deadlines just means no coloured borders.
    func refreshDeadlines() async {
        let modules = Set(events.map(DeadlineRules.moduleKey(for:)))
        guard !modules.isEmpty else {
            deadlines = []
            return
        }
        guard let shared = try? await deadlineStore.deadlines(forModules: Array(modules)) else { return }
        deadlines = shared
    }

    /// Every module seen in any week loaded so far, for the deadlines tab.
    ///
    /// Taken from the raw events, before group filtering: hiding a lab group you're not in
    /// doesn't stop you taking the module, so it must not hide the module's dates. Spans
    /// every loaded week because a module that doesn't run this week still has deadlines.
    var moduleKeys: [String] {
        Set(rawByWeekNumber.values.flatMap { $0 }.map(DeadlineRules.moduleKey(for:))).sorted()
    }

    private var currentWeek: TeachingWeek? {
        weeks.indices.contains(weekIndex) ? weeks[weekIndex] : nil
    }

    /// The campus shared by every located class this week — nil if they span campuses (or
    /// nothing has a room, e.g. an all-online week).
    var campusName: String? {
        let campuses = Set(events.flatMap { $0.parsedLocations.compactMap(\.campus) })
        guard campuses.count == 1 else { return nil }
        return campuses.first?.name
    }

    /// Current week's events grouped by calendar day.
    var eventsByDay: [(day: Date, events: [TimetableEvent])] {
        grouped(currentWeek.map { eventsByWeekNumber[$0.number] ?? [] } ?? [])
    }

    /// Any week's events grouped by day — the calendar pager asks for its neighbours.
    func eventsByDay(forWeekIndex index: Int) -> [(day: Date, events: [TimetableEvent])] {
        guard let resolved = PagerIndex.resolve(index, count: weeks.count, bounds: Self.weekBounds)
        else { return [] }
        return grouped(eventsByWeekNumber[weeks[resolved].number] ?? [])
    }

    private func grouped(_ list: [TimetableEvent]) -> [(day: Date, events: [TimetableEvent])] {
        let cal = Foundation.Calendar.current
        return Dictionary(grouping: list) { cal.startOfDay(for: $0.start) }
            .map { (day: $0.key, events: $0.value.sorted { $0.start < $1.start }) }
            .sorted { $0.day < $1.day }
    }

    func start() async {
        if weeks.isEmpty {
            do {
                let cal = try await source.weekCalendar()
                weeks = cal.weeks
                if let current = cal.current,
                   let idx = cal.weeks.firstIndex(where: { $0.number == current.number }) {
                    weekIndex = idx
                }
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't load the calendar."
            }
        }
        await loadCurrentWeek()
    }

    /// The academic year has a first and a last week; the pager stops at both.
    static let weekBounds: PagerBounds = .clamped

    /// Move the pager without loading — the view's onChange drives the load, so a swipe
    /// and a chevron press take the same path.
    func stepIndex(by delta: Int) {
        guard !weeks.isEmpty else { return }
        weekIndex = PagerIndex.step(from: weekIndex, by: delta,
                                    count: weeks.count, bounds: Self.weekBounds)
    }

    /// Whether the chevron in that direction has anywhere to go.
    func canStep(by delta: Int) -> Bool {
        PagerIndex.canStep(from: weekIndex, by: delta,
                           count: weeks.count, bounds: Self.weekBounds)
    }

    /// Re-apply group filtering when the student changes their selection.
    func updateHiddenGroups(_ hidden: Set<String>) {
        hiddenGroups = hidden
        applyFilter()
    }

    /// Idempotent: the pager re-asks for the same week constantly, so already-loaded weeks
    /// only refresh their labels. Neighbours are fetched so a drag has real content to show.
    func loadCurrentWeek() async {
        guard let week = currentWeek else { return }
        weekLabel = "Week \(week.label)"
        weekStart = week.firstDay
        errorText = nil
        applyFilter()

        if rawByWeekNumber[week.number] == nil {
            isLoading = true
            await load(week, isCurrent: true)
            isLoading = false
        }
        await refreshCancellations()
        await refreshDeadlines()

        for neighbour in neighbours(of: weekIndex) where rawByWeekNumber[neighbour.number] == nil {
            await load(neighbour, isCurrent: false)
        }
    }

    private func neighbours(of index: Int) -> [TeachingWeek] {
        guard !weeks.isEmpty else { return [] }
        return [-1, 1].compactMap { delta in
            PagerIndex.resolve(index + delta, count: weeks.count, bounds: Self.weekBounds)
                .map { weeks[$0] }
        }
    }

    private func load(_ week: TeachingWeek, isCurrent: Bool) async {
        if let cached = await cache.snapshot(categoryID: programme.identity, weekNumber: week.number) {
            rawByWeekNumber[week.number] = cached.events
            applyFilter()
        }
        do {
            let fetched = try await source.events(for: programme, weeks: [week])
            rawByWeekNumber[week.number] = fetched
            applyFilter()
            await cache.store(TimetableSnapshot(category: programme, weekNumber: week.number,
                                                events: fetched, fetchedAt: Date()))
        } catch {
            if isCurrent, (rawByWeekNumber[week.number] ?? []).isEmpty {
                errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't load this week."
            }
        }
    }

    private func applyFilter() {
        eventsByWeekNumber = rawByWeekNumber.mapValues { GroupCatalog.filter($0, hiding: hiddenGroups) }
        // `moduleKeys` reads `rawByWeekNumber`, which isn't published; mirroring it here is
        // what tells the deadlines tab a newly-loaded week brought a module with it.
        loadedModuleKeys = moduleKeys
        let current = currentWeek.map { eventsByWeekNumber[$0.number] ?? [] } ?? []
        events = current
        clashingIDs = ClashDetector.clashingEventIDs(in: current)
        if !engLabModules.isEmpty {
            hasEngineeringLabs = rawByWeekNumber.values.flatMap { $0 }
                .contains { engLabModules.contains($0.moduleCode ?? "") }
        }
    }
}
