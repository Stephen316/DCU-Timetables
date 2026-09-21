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

/// How many people reported a class, counted by the server rather than on the device.
///
/// The device no longer sees who reported what — that is the point (see
/// `supabase/phase3_anonymity.sql`). It gets a number and one boolean about itself, which
/// is everything it ever displayed.
public struct CancellationTally: Sendable, Equatable {
    public let eventKey: String
    public let reportCount: Int
    public let reportedByMe: Bool

    public init(eventKey: String, reportCount: Int, reportedByMe: Bool) {
        self.eventKey = eventKey
        self.reportCount = reportCount
        self.reportedByMe = reportedByMe
    }
}

/// What is known about whether a class is on: what the crowd says, whether this person is
/// part of it, and any definitive verdict that outranks both.
public struct CancellationStatus: Sendable, Equatable {
    public let reportCount: Int
    public let reportedByMe: Bool
    /// A trusted person's statement. When present it decides the outcome and the crowd
    /// count becomes context, not evidence.
    public let verdict: EventVerdict?

    /// Precedence: a verdict, then the crowd, then nothing.
    ///
    /// Note `.running` deliberately returns false even with a hundred reports behind it —
    /// that is the entire purpose of a `running` verdict, and treating it as merely one
    /// more vote would make it useless.
    public var isFlagged: Bool {
        switch verdict?.state {
        case .cancelled: return true
        case .running:   return false
        case .moved:     return false
        case nil:        return reportCount >= CancellationRules.threshold
        }
    }

    /// On, but not where or when the timetable says. Kept apart from `isFlagged` because
    /// turning up to the wrong room and not turning up at all need different warnings.
    public var isMoved: Bool { verdict?.state == .moved }

    /// Whether the claim is someone's stated fact rather than a tally of guesses. The UI
    /// leans on this to style the two differently.
    public var isDecided: Bool { verdict != nil }

    /// Always the real number, never "x of 3" — the threshold decides whether the class is
    /// *flagged*, but eleven people saying a lecture is off means more than three, and
    /// capping the wording hides that. Same rule as `DeadlineStanding.summary`.
    public var summary: String {
        if let verdict { return verdict.headline }
        switch reportCount {
        case ..<1: return "Nobody has reported this class as off"
        case 1: return "1 person says this isn't on"
        default: return "\(reportCount) people say this isn't on"
        }
    }

    /// What the crowd said, shown *underneath* a verdict rather than instead of it. Three
    /// students disagreeing with an organiser is worth seeing, not worth hiding.
    public var crowdSummary: String? {
        guard verdict != nil, reportCount > 0 else { return nil }
        return reportCount == 1
            ? "1 person had reported this as off"
            : "\(reportCount) people had reported this as off"
    }

    public init(reportCount: Int, reportedByMe: Bool, verdict: EventVerdict? = nil) {
        self.reportCount = reportCount
        self.reportedByMe = reportedByMe
        self.verdict = verdict
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
                              reporterID: String,
                              verdict: EventVerdict? = nil) -> CancellationStatus {
        let reporters = Set(reports.filter { $0.eventKey == key }.map(\.reporterID))
        return CancellationStatus(reportCount: reporters.count,
                                  reportedByMe: reporters.contains(reporterID),
                                  verdict: verdict)
    }

    /// Tally every class in one pass, keyed by event key.
    /// Build statuses from server-side tallies. Same precedence as the report-based
    /// version below, which stays for the local fallback store and for the pure tests.
    public static func statuses(from tallies: [CancellationTally],
                                verdicts: [EventVerdict] = []) -> [String: CancellationStatus] {
        let byKey = Dictionary(verdicts.map { ($0.eventKey, $0) }) { first, _ in first }
        var result: [String: CancellationStatus] = [:]
        for tally in tallies {
            result[tally.eventKey] = CancellationStatus(reportCount: tally.reportCount,
                                                        reportedByMe: tally.reportedByMe,
                                                        verdict: byKey[tally.eventKey])
        }
        // A verdict on a class nobody reported has no tally row to decorate.
        for (key, verdict) in byKey where result[key] == nil {
            result[key] = CancellationStatus(reportCount: 0, reportedByMe: false, verdict: verdict)
        }
        return result
    }

    public static func statuses(from reports: [CancellationReport],
                                reporterID: String,
                                verdicts: [EventVerdict] = []) -> [String: CancellationStatus] {
        var reporters: [String: Set<String>] = [:]
        for report in reports {
            reporters[report.eventKey, default: []].insert(report.reporterID)
        }
        let byKey = Dictionary(verdicts.map { ($0.eventKey, $0) }) { first, _ in first }

        var result = reporters.mapValues {
            CancellationStatus(reportCount: $0.count,
                               reportedByMe: $0.contains(reporterID),
                               verdict: nil)
        }
        // A verdict on a class nobody reported still has to appear, so this walks the
        // verdicts rather than only decorating rows the crowd happened to create.
        for (key, verdict) in byKey {
            let existing = result[key]
            result[key] = CancellationStatus(reportCount: existing?.reportCount ?? 0,
                                             reportedByMe: existing?.reportedByMe ?? false,
                                             verdict: verdict)
        }
        return result
    }
}
