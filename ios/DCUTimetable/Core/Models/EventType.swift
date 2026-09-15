import Foundation

/// How a class is delivered. Mapped from the API's free-text `EventType` string.
public enum EventType: String, Codable, Sendable, CaseIterable {
    case onCampus
    case synchronous
    case asynchronous
    case booking
    case unknown

    public init(apiValue raw: String?) {
        let s = (raw ?? "").lowercased()
        if s.contains("on campus") || s.contains("on-campus") {
            self = .onCampus
        } else if s.contains("async") {
            self = .asynchronous
        } else if s.contains("sync") {
            self = .synchronous
        } else if s.contains("booking") {
            self = .booking
        } else {
            self = .unknown
        }
    }

    public var label: String {
        switch self {
        case .onCampus:     return "On campus"
        case .synchronous:  return "Online (live)"
        case .asynchronous: return "Recorded"
        case .booking:      return "Booking"
        case .unknown:      return "Class"
        }
    }
}
