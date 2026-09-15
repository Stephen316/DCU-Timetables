import Foundation

/// Builds a Year-1 Engineering student's personal timetable from a `StudentProfile`:
/// the shared EEG module set, with the generic lab slots replaced by the student's own
/// lab rotation (by group). Conforms to `TimetableSource` so it drops into the week view.
public struct ProfileTimetableSource: TimetableSource {
    private let profile: StudentProfile
    private let moduleCodes: [String]
    private let rotation: LabRotation?
    private let client: DCUAPIClient

    public init(profile: StudentProfile, client: DCUAPIClient = DCUAPIClient()) {
        self.profile = profile
        self.client = client
        self.moduleCodes = EngineeringYear1.bundled()?.modules ?? []
        self.rotation = LabRotationLoader.bundled()
    }

    public func searchProgrammes(query: String, page: Int) async throws -> [TimetableCategory] { [] }

    public func weekCalendar() async throws -> WeekCalendar {
        try await client.weekCalendar()
    }

    public func events(for category: TimetableCategory, weeks: [TeachingWeek]) async throws -> [TimetableEvent] {
        var events = try await client.events(forModuleCodes: moduleCodes, weeks: weeks)

        if let rotation {
            // Drop the generic lab slots for the rotation modules — the student's real labs
            // come from their group's rotation, not the all-groups timetable slot.
            let rotationModules = rotation.moduleCodes
            events = events.filter { event in
                !(rotationModules.contains(event.moduleCode ?? "") && event.activity.kind == .practical)
            }
            // Inject this student's rotation sessions for the requested weeks.
            let wanted = Set(weeks.map(\.number))
            let sessions = rotation.sessions(forGroup: profile.group).filter { wanted.contains($0.week) }
            events += sessions.compactMap { rotationEvent($0, rotation) }
        }

        return events.sorted { $0.start < $1.start }
    }

    // The rotation PDF's times are Irish local clock times, so build the dates in the
    // Dublin timezone (the API's own events are true UTC and handled separately).
    private static let dublin = TimeZone(identifier: "Europe/Dublin") ?? .current

    private func localDate(_ dateString: String, _ time: String) -> Date? {
        let d = dateString.split(separator: "-").compactMap { Int($0) }
        let t = time.split(separator: ":").compactMap { Int($0) }
        guard d.count == 3, t.count == 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = Self.dublin
        return calendar.date(from: DateComponents(year: d[0], month: d[1], day: d[2],
                                                  hour: t[0], minute: t[1]))
    }

    private func rotationEvent(_ session: LabSession, _ rotation: LabRotation) -> TimetableEvent? {
        guard let start = localDate(session.date, session.start),
              let end = localDate(session.date, session.end)
        else { return nil }

        let activity = rotation.activity(for: session.module)
        let room: [String]
        let lower = activity.lowercased()
        if lower.contains("workshop") {
            room = profile.workshop.isEmpty ? [] : [profile.workshop]
        } else if lower.contains("drawing") {
            room = profile.drawing.isEmpty ? [] : [profile.drawing]
        } else {
            room = []
        }

        return TimetableEvent(
            id: "rotation-\(session.id)",
            start: start,
            end: end,
            type: .onCampus,
            locations: room,
            moduleName: "\(activity) · \(rotation.name(for: session.module))",
            staff: [],
            activity: ActivityCode(session.module),   // module code parses out of the first token
            weekLabels: ["\(session.week)"]
        )
    }
}
