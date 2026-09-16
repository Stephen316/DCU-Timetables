import Foundation
import SwiftUI

@MainActor
final class WeekViewModel: ObservableObject {
    @Published var events: [TimetableEvent] = []          // filtered to the student's groups
    @Published var clashingIDs: Set<String> = []
    @Published var isLoading = false
    @Published var errorText: String?
    @Published var lastUpdated: Date?
    @Published var weekLabel: String = ""
    @Published var hasEngineeringLabs = false
    /// Monday of the week being shown, so the day view can lay out Mon–Fri.
    @Published private(set) var weekStart: Date?
    /// Which way the last week change went, so the view slides in the matching direction.
    @Published private(set) var slide: SlideDirection = .none

    enum SlideDirection { case forward, backward, none }

    let programme: TimetableCategory
    private let source: TimetableSource
    private let cache: TimetableCache

    private var calendar: WeekCalendar?
    private var week: TeachingWeek?
    private var rawEvents: [TimetableEvent] = []          // everything fetched, unfiltered
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

    /// The campus shared by every located class this week — nil if they span campuses (or
    /// nothing has a room, e.g. an all-online week).
    var campusName: String? {
        let campuses = Set(events.flatMap { $0.parsedLocations.compactMap(\.campus) })
        guard campuses.count == 1 else { return nil }
        return campuses.first?.name
    }

    /// Events grouped by calendar day, days in order.
    var eventsByDay: [(day: Date, events: [TimetableEvent])] {
        let cal = Foundation.Calendar.current
        let groups = Dictionary(grouping: events) { cal.startOfDay(for: $0.start) }
        return groups
            .map { (day: $0.key, events: $0.value.sorted { $0.start < $1.start }) }
            .sorted { $0.day < $1.day }
    }

    func start() async {
        if calendar == nil {
            do {
                let cal = try await source.weekCalendar()
                calendar = cal
                week = cal.current
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't load the calendar."
            }
        }
        await loadWeek()
    }

    func goToPreviousWeek() async { await move(by: -1) }
    func goToNextWeek() async { await move(by: 1) }

    /// Re-apply group filtering when the student changes their selection.
    func updateHiddenGroups(_ hidden: Set<String>) {
        hiddenGroups = hidden
        applyFilter()
    }

    private func move(by delta: Int) async {
        guard let calendar, let current = week,
              let idx = calendar.weeks.firstIndex(where: { $0.number == current.number }) else { return }
        let next = idx + delta
        guard calendar.weeks.indices.contains(next) else { return }

        let target = calendar.weeks[next]
        slide = delta > 0 ? .forward : .backward
        isLoading = true                      // set before clearing, so no "no classes" flash
        // Mutate inside an explicit transaction: the view keys its slide transition off
        // weekLabel, and `.animation(_:value:)` alone does not reliably drive an
        // identity (.id) change. Cleared here so the outgoing week doesn't slide out
        // already relabelled.
        withAnimation(.easeInOut(duration: 0.28)) {
            week = target
            weekLabel = "Week \(target.label)"
            rawEvents = []
            events = []
            clashingIDs = []
        }
        await loadWeek()
    }

    private func loadWeek() async {
        guard let week else { return }

        // Read the cache *before* touching published state so the label and the events
        // change together in one render pass. Otherwise the await suspends mid-update and
        // the week-change animation slides in the previous week's classes.
        let cached = await cache.snapshot(categoryID: programme.identity, weekNumber: week.number)
        weekLabel = "Week \(week.label)"
        weekStart = week.firstDay
        rawEvents = cached?.events ?? []
        lastUpdated = cached?.fetchedAt
        errorText = nil
        applyFilter()

        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await source.events(for: programme, weeks: [week])
            rawEvents = fetched
            lastUpdated = Date()
            applyFilter()
            await cache.store(TimetableSnapshot(category: programme, weekNumber: week.number,
                                                events: fetched, fetchedAt: Date()))
        } catch {
            if rawEvents.isEmpty {
                errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't load this week."
            }
        }
    }

    private func applyFilter() {
        let filtered = GroupCatalog.filter(rawEvents, hiding: hiddenGroups)
        events = filtered
        clashingIDs = ClashDetector.clashingEventIDs(in: filtered)
        if !engLabModules.isEmpty {
            hasEngineeringLabs = rawEvents.contains { engLabModules.contains($0.moduleCode ?? "") }
        }
    }
}
