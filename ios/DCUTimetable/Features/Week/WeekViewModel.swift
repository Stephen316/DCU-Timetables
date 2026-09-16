import Foundation

@MainActor
final class WeekViewModel: ObservableObject {
    @Published var events: [TimetableEvent] = []          // filtered to the student's groups
    @Published var clashingIDs: Set<String> = []
    @Published var isLoading = false
    @Published var errorText: String?
    @Published var lastUpdated: Date?
    @Published var weekLabel: String = ""
    @Published var hasEngineeringLabs = false

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
        week = calendar.weeks[next]
        await loadWeek()
    }

    private func loadWeek() async {
        guard let week else { return }
        weekLabel = "Week \(week.label)"

        // Offline-first: show cached snapshot immediately.
        if let snap = await cache.snapshot(categoryID: programme.identity, weekNumber: week.number) {
            rawEvents = snap.events
            lastUpdated = snap.fetchedAt
            applyFilter()
        }

        isLoading = true
        errorText = nil
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
