import Foundation
import SwiftUI

@MainActor
final class WeekViewModel: ObservableObject {
    @Published var events: [TimetableEvent] = []          // current week, filtered to groups
    @Published var clashingIDs: Set<String> = []
    @Published var isLoading = false
    @Published var errorText: String?
    @Published var lastUpdated: Date?
    @Published var weekLabel: String = ""
    @Published var hasEngineeringLabs = false
    /// Monday of the week being shown, so the day view can lay out Mon–Fri.
    @Published private(set) var weekStart: Date?
    /// Position in `weeks`. Bound directly to the calendar pager.
    @Published var weekIndex = 0
    /// Filtered events keyed by week number, for the weeks the pager can reach.
    @Published private(set) var eventsByWeekNumber: [Int: [TimetableEvent]] = [:]

    private(set) var weeks: [TeachingWeek] = []

    let programme: TimetableCategory
    private let source: TimetableSource
    private let cache: TimetableCache

    private var rawByWeekNumber: [Int: [TimetableEvent]] = [:]
    private var loadedAt: [Int: Date] = [:]
    private var hiddenGroups: Set<String>
    private let engLabModules = LabRotationLoader.bundled()?.moduleCodes ?? []

    init(programme: TimetableCategory,
         hiddenGroups: Set<String> = [],
         source: TimetableSource = DCUAPIClient(),
         cache: TimetableCache = TimetableCache()) {
        self.programme = programme
        self.hiddenGroups = hiddenGroups
        self.source = source
        self.cache = cache
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
        let wrapped = weeks.isEmpty ? 0 : ((index % weeks.count) + weeks.count) % weeks.count
        guard weeks.indices.contains(wrapped) else { return [] }
        return grouped(eventsByWeekNumber[weeks[wrapped].number] ?? [])
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

    /// Move the pager without loading — the view's onChange drives the load, so a swipe
    /// and a chevron press take the same path.
    func stepIndex(by delta: Int) {
        guard !weeks.isEmpty else { return }
        weekIndex = ((weekIndex + delta) % weeks.count + weeks.count) % weeks.count
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
        lastUpdated = loadedAt[week.number]
        applyFilter()

        if rawByWeekNumber[week.number] == nil {
            isLoading = true
            await load(week, isCurrent: true)
            isLoading = false
        }
        for neighbour in neighbours(of: weekIndex) where rawByWeekNumber[neighbour.number] == nil {
            await load(neighbour, isCurrent: false)
        }
    }

    private func neighbours(of index: Int) -> [TeachingWeek] {
        guard !weeks.isEmpty else { return [] }
        return [-1, 1].compactMap { delta in
            let i = ((index + delta) % weeks.count + weeks.count) % weeks.count
            return weeks.indices.contains(i) ? weeks[i] : nil
        }
    }

    private func load(_ week: TeachingWeek, isCurrent: Bool) async {
        if let cached = await cache.snapshot(categoryID: programme.identity, weekNumber: week.number) {
            rawByWeekNumber[week.number] = cached.events
            loadedAt[week.number] = cached.fetchedAt
            if isCurrent { lastUpdated = cached.fetchedAt }
            applyFilter()
        }
        do {
            let fetched = try await source.events(for: programme, weeks: [week])
            rawByWeekNumber[week.number] = fetched
            loadedAt[week.number] = Date()
            if isCurrent { lastUpdated = Date() }
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
        let current = currentWeek.map { eventsByWeekNumber[$0.number] ?? [] } ?? []
        events = current
        clashingIDs = ClashDetector.clashingEventIDs(in: current)
        if !engLabModules.isEmpty {
            hasEngineeringLabs = rawByWeekNumber.values.flatMap { $0 }
                .contains { engLabModules.contains($0.moduleCode ?? "") }
        }
    }
}
