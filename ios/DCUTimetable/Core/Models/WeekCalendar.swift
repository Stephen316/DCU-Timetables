import Foundation

/// One teaching week, as defined by DCU (the week→date mapping comes from the API, so
/// there is no local academic calendar to maintain).
public struct TeachingWeek: Identifiable, Equatable, Sendable, Codable {
    public let number: Int
    public let label: String
    public let firstDay: Date

    public var id: Int { number }

    public init(number: Int, label: String, firstDay: Date) {
        self.number = number
        self.label = label
        self.firstDay = firstDay
    }
}

/// A day option offered by the API (used to build a complete event request).
public struct DayOption: Equatable, Sendable, Codable {
    public let name: String
    public let dayOfWeek: Int
    public init(name: String, dayOfWeek: Int) {
        self.name = name
        self.dayOfWeek = dayOfWeek
    }
}

/// The institution's week calendar for the current academic year.
public struct WeekCalendar: Equatable, Sendable, Codable {
    public let weeks: [TeachingWeek]
    public let days: [DayOption]

    public init(weeks: [TeachingWeek], days: [DayOption]) {
        self.weeks = weeks.sorted { $0.firstDay < $1.firstDay }
        self.days = days
    }

    /// The teaching week containing `date`, if any.
    public func week(containing date: Date) -> TeachingWeek? {
        weeks.last { $0.firstDay <= date }
    }

    /// The current teaching week (or the first, out of term).
    public var current: TeachingWeek? {
        week(containing: Date()) ?? weeks.first
    }
}
