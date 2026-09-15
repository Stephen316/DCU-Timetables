import Foundation

/// The seam between the app and wherever timetable data comes from.
///
/// The live DCU JSON API is one implementation (`DCUAPIClient`). An iCal importer or a
/// backend proxy can be dropped in behind this same protocol without touching Core,
/// the cache, or the UI.
public protocol TimetableSource: Sendable {
    /// Search programmes of study by free text (paged).
    func searchProgrammes(query: String, page: Int) async throws -> [TimetableCategory]

    /// The institution's week calendar for the current academic year.
    func weekCalendar() async throws -> WeekCalendar

    /// All events for a category (programme/module/room) across the given weeks.
    func events(for category: TimetableCategory, weeks: [TeachingWeek]) async throws -> [TimetableEvent]
}

public extension TimetableSource {
    func searchProgrammes(query: String) async throws -> [TimetableCategory] {
        try await searchProgrammes(query: query, page: 1)
    }
}

/// Errors surfaced by a `TimetableSource`.
public enum TimetableSourceError: Error, LocalizedError {
    case http(status: Int)
    case decoding(String)
    case noData

    public var errorDescription: String? {
        switch self {
        case .http(let status): return "The timetable service returned an error (\(status))."
        case .decoding(let detail): return "Couldn't read the timetable data. \(detail)"
        case .noData: return "No timetable data was returned."
        }
    }
}
