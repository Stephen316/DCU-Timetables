import Foundation

/// How the deadlines tab is broken up. Chronological buckets rather than one long list:
/// "what's on me right now" and "what's months away" need different amounts of attention,
/// and a flat list sorted by date makes the reader work that out for themselves.
public enum DeadlineSection: String, CaseIterable, Sendable {
    case today, thisWeek, nextWeek, later

    public var title: String {
        switch self {
        case .today: return "Today"
        case .thisWeek: return "This week"
        case .nextWeek: return "Next week"
        case .later: return "Later"
        }
    }
}

/// Buckets every shared deadline by how soon it is.
public enum DeadlineSchedule {
    /// Weeks run Monday to Sunday here, matching the timetable, not the device's locale —
    /// a student's "this week" is the teaching week, and on a Sunday-first calendar
    /// Friday's assignment would otherwise land in "next week".
    private static func mondayFirst(_ calendar: Calendar) -> Calendar {
        var cal = calendar
        cal.firstWeekday = 2
        return cal
    }

    public static func section(for due: Date, now: Date = Date(),
                               calendar: Calendar = .current) -> DeadlineSection {
        let cal = mondayFirst(calendar)
        let today = cal.startOfDay(for: now)
        let day = cal.startOfDay(for: due)
        guard day > today else { return .today }   // today, and anything the day filter left

        guard let thisWeek = cal.dateInterval(of: .weekOfYear, for: today),
              let nextWeek = cal.dateInterval(of: .weekOfYear, for: thisWeek.end)
        else { return .later }

        if day < thisWeek.end { return .thisWeek }
        if day < nextWeek.end { return .nextWeek }
        return .later
    }

    /// Soonest first within each bucket, and empty buckets dropped so the list has no
    /// headings standing over nothing.
    public static func grouped(_ deadlines: [Deadline], now: Date = Date(),
                               calendar: Calendar = .current)
    -> [(section: DeadlineSection, deadlines: [Deadline])] {
        let sorted = DeadlineRules.upcoming(deadlines, now: now, calendar: calendar)
        let bySection = Dictionary(grouping: sorted) {
            section(for: $0.due, now: now, calendar: calendar)
        }
        return DeadlineSection.allCases.compactMap { section in
            guard let list = bySection[section], !list.isEmpty else { return nil }
            return (section: section, deadlines: list)
        }
    }

    /// The tests a student sits, split from the things they hand in. Missing a quiz is
    /// unrecoverable in a way a late upload isn't, so the tab counts them separately.
    public static func sitInClass(_ deadlines: [Deadline]) -> [Deadline] {
        deadlines.filter { $0.kind.isSatInClass }
    }
}
