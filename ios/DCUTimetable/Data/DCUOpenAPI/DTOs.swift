import Foundation

// Codable mirrors of the DCU MyTimetable v4 public API. See docs/API.md.
// PascalCase JSON keys are mapped explicitly. The Week/Day/TimePeriod/DatePeriod DTOs
// are used both to DECODE ViewOptions and to ENCODE the events request.

struct WeekDTO: Codable {
    let weekNumber: Int
    let weekLabel: String
    let firstDayInWeek: String
    enum CodingKeys: String, CodingKey {
        case weekNumber = "WeekNumber"
        case weekLabel = "WeekLabel"
        case firstDayInWeek = "FirstDayInWeek"
    }
}

struct DayDTO: Codable {
    let name: String
    let dayOfWeek: Int
    let isDefault: Bool?
    enum CodingKeys: String, CodingKey {
        case name = "Name"
        case dayOfWeek = "DayOfWeek"
        case isDefault = "IsDefault"
    }
}

struct TimePeriodDTO: Codable {
    let description: String?
    let startTime: String
    let endTime: String
    let isDefault: Bool?
    enum CodingKeys: String, CodingKey {
        case description = "Description"
        case startTime = "StartTime"
        case endTime = "EndTime"
        case isDefault = "IsDefault"
    }
}

struct DatePeriodDTO: Codable {
    let description: String?
    let startDateTime: String
    let endDateTime: String
    let isDefault: Bool?
    let type: String?
    enum CodingKeys: String, CodingKey {
        case description = "Description"
        case startDateTime = "StartDateTime"
        case endDateTime = "EndDateTime"
        case isDefault = "IsDefault"
        case type = "Type"
    }
}

struct ViewOptionsDTO: Codable {
    let weeks: [WeekDTO]
    let days: [DayDTO]
    let timePeriods: [TimePeriodDTO]?
    let datePeriods: [DatePeriodDTO]?
    enum CodingKeys: String, CodingKey {
        case weeks = "Weeks"
        case days = "Days"
        case timePeriods = "TimePeriods"
        case datePeriods = "DatePeriods"
    }
}

// MARK: - Category search
//
// The search term is passed in the URL query string (?query=…&itemsPerPage=…&
// pageNumber=…&returnOccurrences=false) with an empty JSON-array body — NOT a body
// `query` field, which the endpoint ignores. See DCUAPIClient.searchProgrammes.

struct CategoryFilterResponseDTO: Codable {
    let totalPages: Int?
    let currentPage: Int?
    let count: Int?
    let results: [CategoryDTO]
    enum CodingKeys: String, CodingKey {
        case totalPages = "TotalPages"
        case currentPage = "CurrentPage"
        case count = "Count"
        case results = "Results"
    }
}

struct CategoryDTO: Codable {
    let identity: String
    let name: String
    let categoryTypeIdentity: String?
    enum CodingKeys: String, CodingKey {
        case identity = "Identity"
        case name = "Name"
        case categoryTypeIdentity = "CategoryTypeIdentity"
    }
}

// MARK: - Events

struct EventsRequestDTO: Encodable {
    let viewOptions: ViewOptionsRequestDTO
    let categoryTypesWithIdentities: [CategoryTypeWithIdentitiesDTO]
    let fetchBookings: Bool
    let fetchPersonalEvents: Bool
    let personalIdentities: [String]
    enum CodingKeys: String, CodingKey {
        case viewOptions = "ViewOptions"
        case categoryTypesWithIdentities = "CategoryTypesWithIdentities"
        case fetchBookings = "FetchBookings"
        case fetchPersonalEvents = "FetchPersonalEvents"
        case personalIdentities = "PersonalIdentities"
    }
}

/// The complete ViewOptions the events endpoint requires — omitting Days / TimePeriods /
/// DatePeriods yields an empty result (see docs/API.md landmine).
struct ViewOptionsRequestDTO: Encodable {
    let days: [DayDTO]
    let weeks: [WeekDTO]
    let timePeriods: [TimePeriodDTO]
    let datePeriods: [DatePeriodDTO]
    enum CodingKeys: String, CodingKey {
        case days = "Days"
        case weeks = "Weeks"
        case timePeriods = "TimePeriods"
        case datePeriods = "DatePeriods"
    }
}

struct CategoryTypeWithIdentitiesDTO: Encodable {
    let categoryTypeIdentity: String
    let categoryIdentities: [String]
    enum CodingKeys: String, CodingKey {
        case categoryTypeIdentity = "CategoryTypeIdentity"
        case categoryIdentities = "CategoryIdentities"
    }
}

struct EventsResponseDTO: Codable {
    let categoryEvents: [CategoryEventsGroupDTO]?
    enum CodingKeys: String, CodingKey {
        case categoryEvents = "CategoryEvents"
    }
}

struct CategoryEventsGroupDTO: Codable {
    let identity: String?
    let name: String?
    let results: [EventDTO]?
    enum CodingKeys: String, CodingKey {
        case identity = "Identity"
        case name = "Name"
        case results = "Results"
    }
}

struct EventDTO: Codable {
    let identity: String?
    let startDateTime: String?
    let endDateTime: String?
    let eventType: String?
    let location: String?
    let description: String?
    let name: String?
    let weekLabels: String?      // API returns e.g. "2" or "1,3,5" — a string, not an array
    let extraProperties: [ExtraPropertyDTO]?
    enum CodingKeys: String, CodingKey {
        case identity = "Identity"
        case startDateTime = "StartDateTime"
        case endDateTime = "EndDateTime"
        case eventType = "EventType"
        case location = "Location"
        case description = "Description"
        case name = "Name"
        case weekLabels = "WeekLabels"
        case extraProperties = "ExtraProperties"
    }
}

struct ExtraPropertyDTO: Codable {
    let name: String?
    let value: String?
    enum CodingKeys: String, CodingKey {
        case name = "Name"
        case value = "Value"
    }
}

// MARK: - Date parsing

enum APIDate {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZZZZZ"
        return f
    }()
    static func date(from s: String) -> Date? { formatter.date(from: s) }
    static func string(from d: Date) -> String { formatter.string(from: d) }
}
