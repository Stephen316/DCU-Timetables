import Foundation

/// A class removed from a course's timetable, or one added to it, for everyone on the course
/// or one group of it. Saved from the console (supabase/phase17_timetable_changes.sql);
/// no personal data.
public struct TimetableChange: Codable, Equatable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable { case remove, add }

    public let id: String
    public let courseKey: String
    /// "C", "C.2", or nil for everyone on the course.
    public let group: String?
    public let kind: Kind
    public let module: String
    /// Remove only: one activity code (EEG1002[1]OC/P1/02); nil hides every class of the
    /// module starting then.
    public let activityCode: String?
    public let title: String?
    /// Dublin calendar dates, yyyy-MM-dd.
    public let dates: [String]
    public let start: String
    public let end: String?
    public let room: String?

    public init(id: String, courseKey: String, group: String? = nil, kind: Kind, module: String,
                activityCode: String? = nil, title: String? = nil, dates: [String], start: String,
                end: String? = nil, room: String? = nil) {
        self.id = id
        self.courseKey = courseKey
        self.group = group
        self.kind = kind
        self.module = module
        self.activityCode = activityCode
        self.title = title
        self.dates = dates
        self.start = start
        self.end = end
        self.room = room
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, module, title, dates, room
        case courseKey = "course_key", group = "grp", activityCode = "activity_code"
        case start = "start_time", end = "end_time"
    }
}

/// Who is looking at a timetable, as far as changes are concerned.
public struct TimetableAudience: Equatable, Sendable {
    public let courseKey: String
    public let group: String?
    public let subgroup: String?

    public init(courseKey: String, group: String? = nil, subgroup: String? = nil) {
        self.courseKey = courseKey
        self.group = group?.isEmpty == true ? nil : group
        self.subgroup = subgroup?.isEmpty == true ? nil : subgroup
    }

    /// DCU programme codes the console groups under one course key. Mirrors `covers` in
    /// web/src/lib/proposals/courses.ts: the six programmes sharing Engineering's first year.
    static let programmeCourses: [String: String] = [
        "BMED1": "EEG1", "CAM1": "EEG1", "CE1": "EEG1", "ECE1": "EEG1", "ME1": "EEG1", "SSE1": "EEG1",
    ]

    /// A student on a programme they picked has no group, so only changes for everyone on
    /// the course reach them.
    public static func forProgramme(code: String) -> TimetableAudience? {
        programmeCourses[code.uppercased()].map { TimetableAudience(courseKey: $0) }
    }

    public static func forProfile(_ profile: StudentProfile) -> TimetableAudience {
        TimetableAudience(courseKey: profile.courseKey ?? profile.cohort.courseKey,
                          group: profile.group, subgroup: profile.subgroup)
    }

    func includes(_ change: TimetableChange) -> Bool {
        guard change.courseKey == courseKey else { return false }
        guard let target = change.group else { return true }
        return target == group || target == subgroup
    }
}

public enum TimetableChanges {
    /// A week's events with this audience's changes applied: removals hidden, additions in
    /// the week put in. `weekStart` bounds the additions; without it none are added.
    public static func apply(_ events: [TimetableEvent], changes: [TimetableChange],
                             audience: TimetableAudience?, weekStart: Date?) -> [TimetableEvent] {
        guard let audience else { return events }
        let mine = changes.filter(audience.includes)
        guard !mine.isEmpty else { return events }

        let removals = mine.filter { $0.kind == .remove }
        var out = events.filter { event in
            let date = DublinTime.dateString(event.start)
            let time = DublinTime.timeString(event.start)
            return !removals.contains { r in
                r.module == event.moduleCode && r.start == time && r.dates.contains(date)
                    && (r.activityCode == nil || r.activityCode == code(event.activity.raw))
            }
        }

        if let weekStart {
            let days = Set((0..<7).compactMap { offset in
                DublinTime.calendar.date(byAdding: .day, value: offset, to: weekStart).map(DublinTime.dateString)
            })
            for add in mine where add.kind == .add {
                for date in add.dates where days.contains(date) {
                    if let event = added(add, on: date) { out.append(event) }
                }
            }
        }
        return out.sorted { $0.start < $1.start }
    }

    /// The code the console matches on: the first word, without a cross-listing comma.
    /// "EEG1002[1]OC/L1/01 <2, 4>" → "EEG1002[1]OC/L1/01" (web/src/lib/dcu/timetable.ts).
    static func code(_ raw: String) -> String {
        let first = raw.trimmingCharacters(in: .whitespaces).split(separator: " ").first.map(String.init) ?? ""
        return first.trimmingCharacters(in: CharacterSet(charactersIn: ","))
    }

    private static func added(_ change: TimetableChange, on date: String) -> TimetableEvent? {
        guard let end = change.end,
              let startDate = DublinTime.date(date, change.start),
              let endDate = DublinTime.date(date, end) else { return nil }
        let title = change.title ?? "Class"
        return TimetableEvent(
            id: "change-\(change.id)-\(date)",
            start: startDate,
            end: endDate,
            type: .onCampus,
            locations: change.room.map { [$0] } ?? [],
            moduleName: "\(title) · \(change.module)",
            staff: [],
            activity: ActivityCode(change.module),
            weekLabels: []
        )
    }
}

/// Irish clock time. Everything the console writes — rotation sessions, changes — is in it,
/// while DCU's own events arrive as true UTC.
public enum DublinTime {
    static let zone = TimeZone(identifier: "Europe/Dublin") ?? .current

    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }()

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = format
        return f
    }
    private static let day = formatter("yyyy-MM-dd")
    private static let clock = formatter("HH:mm")

    public static func dateString(_ date: Date) -> String { day.string(from: date) }
    public static func timeString(_ date: Date) -> String { clock.string(from: date) }

    /// "2026-10-14" at "14:00", Dublin time.
    public static func date(_ dateString: String, _ time: String) -> Date? {
        let d = dateString.split(separator: "-").compactMap { Int($0) }
        let t = time.split(separator: ":").compactMap { Int($0) }
        guard d.count == 3, t.count == 2 else { return nil }
        return calendar.date(from: DateComponents(year: d[0], month: d[1], day: d[2], hour: t[0], minute: t[1]))
    }
}
