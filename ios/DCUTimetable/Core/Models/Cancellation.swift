import Foundation

/// One student's report that a class isn't on.
public struct CancellationReport: Codable, Sendable, Equatable {
    /// Identifies the specific occurrence being reported (see `CancellationRules.eventKey`).
    public let eventKey: String
    /// Anonymous per-install id — never a name or account. Used only to stop one device
    /// counting several times.
    public let reporterID: String
    public let reportedAt: Date

    public init(eventKey: String, reporterID: String, reportedAt: Date = Date()) {
        self.eventKey = eventKey
        self.reporterID = reporterID
        self.reportedAt = reportedAt
    }
}

/// How many people say a class is off, and whether this device is one of them.
public struct CancellationStatus: Sendable, Equatable {
    public let reportCount: Int
    public let reportedByMe: Bool

    public var isFlagged: Bool { reportCount >= CancellationRules.threshold }

    /// Always the real number, never "x of 3" — the threshold decides whether the class is
    /// *flagged*, but eleven people saying a lecture is off means more than three, and
    /// capping the wording hides that. Same rule as `DeadlineStanding.summary`.
    public var summary: String {
        switch reportCount {
        case ..<1: return "Nobody has reported this class as off"
        case 1: return "1 person says this isn't on"
        default: return "\(reportCount) people say this isn't on"
        }
    }

    public init(reportCount: Int, reportedByMe: Bool) {
        self.reportCount = reportCount
        self.reportedByMe = reportedByMe
    }
}

public enum CancellationRules {
    /// Independent devices needed before a class is flagged.
    public static let threshold = 3

    private static let keyFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// A stable id for one occurrence of a class, identical on every student's device.
    ///
    /// Built from the activity code and the exact start time rather than the API's own
    /// event identity, which is not guaranteed stable between queries — if it changed, the
    /// same lecture would split into two report buckets and never reach the threshold.
    public static func eventKey(for event: TimetableEvent) -> String {
        "\(event.activity.raw)|\(keyFormatter.string(from: event.start))"
    }

    /// Tally reports for one class. Repeat reports from the same device count once, so a
    /// single person can't flag a lecture on their own.
    public static func status(forKey key: String,
                              reports: [CancellationReport],
                              reporterID: String) -> CancellationStatus {
        let reporters = Set(reports.filter { $0.eventKey == key }.map(\.reporterID))
        return CancellationStatus(reportCount: reporters.count,
                                  reportedByMe: reporters.contains(reporterID))
    }

    /// Tally every class in one pass, keyed by event key.
    public static func statuses(from reports: [CancellationReport],
                                reporterID: String) -> [String: CancellationStatus] {
        var reporters: [String: Set<String>] = [:]
        for report in reports {
            reporters[report.eventKey, default: []].insert(report.reporterID)
        }
        return reporters.mapValues {
            CancellationStatus(reportCount: $0.count, reportedByMe: $0.contains(reporterID))
        }
    }
}
