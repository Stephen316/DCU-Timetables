import Foundation

/// Which way a student voted on one occurrence of a class.
///
/// Disagreement is a first-class answer, not the absence of a report. Before this existed
/// the only way to push back on three mistaken "cancelled" reports was to find a class rep
/// with a verdict button; now anyone who walked into a running lecture can say so.
public enum ReportStance: String, Codable, Sendable, CaseIterable {
    /// The class was cancelled.
    case cancelled
    /// The class went ahead — posted against someone else's cancellation report.
    case on

    public var label: String {
        switch self {
        case .cancelled: return "cancelled"
        case .on:        return "on"
        }
    }
}

/// One student's report about whether a class ran.
public struct CancellationReport: Codable, Sendable, Equatable {
    /// Identifies the specific occurrence being reported (see `CancellationRules.eventKey`).
    public let eventKey: String
    /// Anonymous per-install id — never a name or account. Used only to stop one device
    /// counting several times.
    public let reporterID: String
    public let stance: ReportStance
    public let reportedAt: Date

    public init(eventKey: String,
                reporterID: String,
                stance: ReportStance = .cancelled,
                reportedAt: Date = Date()) {
        self.eventKey = eventKey
        self.reporterID = reporterID
        self.stance = stance
        self.reportedAt = reportedAt
    }

    /// Rows written before stances existed are all cancellation reports, which is what the
    /// column default says server-side too. Without this a single legacy row on disk would
    /// make the whole local file fail to decode and silently empty itself.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        eventKey = try c.decode(String.self, forKey: .eventKey)
        reporterID = try c.decode(String.self, forKey: .reporterID)
        stance = try c.decodeIfPresent(ReportStance.self, forKey: .stance) ?? .cancelled
        reportedAt = try c.decode(Date.self, forKey: .reportedAt)
    }
}

/// How many people reported a class each way, counted by the server rather than on the
/// device.
///
/// The device no longer sees who reported what — that is the point (see
/// `supabase/phase3_anonymity.sql`). It gets two numbers and its own stance, which is
/// everything it ever displayed.
public struct CancellationTally: Sendable, Equatable {
    public let eventKey: String
    public let reportCount: Int
    public let onCount: Int
    public let myStance: ReportStance?

    public init(eventKey: String, reportCount: Int, onCount: Int = 0, myStance: ReportStance? = nil) {
        self.eventKey = eventKey
        self.reportCount = reportCount
        self.onCount = onCount
        self.myStance = myStance
    }
}

/// What is known about whether a class is on: what the crowd says, how this person voted,
/// and any definitive verdict that outranks both.
public struct CancellationStatus: Sendable, Equatable {
    /// People who reported the class cancelled.
    public let reportCount: Int
    /// People who reported it went ahead anyway.
    public let onCount: Int
    public let myStance: ReportStance?
    /// A trusted person's statement. When present it decides the outcome and the crowd
    /// count becomes context, not evidence.
    public let verdict: EventVerdict?

    public var reportedByMe: Bool { myStance == .cancelled }

    /// Precedence: a verdict, then the crowd, then nothing.
    ///
    /// Note `.running` deliberately returns false even with a hundred reports behind it —
    /// that is the entire purpose of a `running` verdict, and treating it as merely one
    /// more vote would make it useless.
    ///
    /// The crowd has to clear two separate bars, and they do different jobs.
    ///
    /// `threshold` is the evidence bar: three independent people must have said the class
    /// was cancelled before it is worth flagging at all. That one is not netted, so a
    /// contradiction can never make the class *easier* to flag by shrinking the crowd
    /// needed to reach it.
    ///
    /// `netThreshold` is the agreement bar, applied to that same crowd once the people who
    /// walked into a running lecture are subtracted. Students saying it went ahead are
    /// contradictory first-hand claims about the same hour, not noise — without the net, a
    /// class stays flagged all day after three people got it wrong, which is the exact
    /// situation the "report on" button exists to fix.
    ///
    /// So 3–0 and 4–1 flag; 3–1 does not, because one of the three has been answered.
    public var isFlagged: Bool {
        switch verdict?.state {
        case .cancelled: return true
        case .running:   return false
        case .moved:     return false
        case nil:
            return reportCount >= CancellationRules.threshold
                && netReports >= CancellationRules.netThreshold
        }
    }

    /// Cancellation reports less the people who contradicted them, floored at zero.
    public var netReports: Int { max(0, reportCount - onCount) }

    /// On, but not where or when the timetable says. Kept apart from `isFlagged` because
    /// turning up to the wrong room and not turning up at all need different warnings.
    public var isMoved: Bool { verdict?.state == .moved }

    /// Whether the claim is someone's stated fact rather than a tally of guesses. The UI
    /// leans on this to style the two differently.
    public var isDecided: Bool { verdict != nil }

    /// Always the real number, never "x of 3" — the threshold decides whether the class is
    /// *flagged*, but eleven people saying a lecture is cancelled means more than three, and
    /// capping the wording hides that. Same rule as `DeadlineStanding.summary`.
    public var summary: String {
        if let verdict { return verdict.headline }
        switch reportCount {
        case ..<1: return "Nobody has reported this class as cancelled"
        case 1: return "1 person says this is cancelled"
        default: return "\(reportCount) people say this is cancelled"
        }
    }

    /// What the crowd said, shown *underneath* a verdict rather than instead of it. Three
    /// students disagreeing with an organiser is worth seeing, not worth hiding.
    public var crowdSummary: String? {
        guard verdict != nil, reportCount > 0 else { return nil }
        return reportCount == 1
            ? "1 person had reported this as cancelled"
            : "\(reportCount) people had reported this as cancelled"
    }

    // MARK: - The banner at the top of the page

    /// This student's own report, stated back to them. Shown separately from the crowd
    /// count because "did I already report this?" is the question they opened the page to
    /// answer, and digging it out of a tally is work.
    public var myReportLine: String? {
        guard let myStance else { return nil }
        switch myStance {
        case .cancelled: return "You reported cancelled"
        case .on:        return "You reported this class went ahead"
        }
    }

    /// Everyone else who said it was cancelled. Counts *others*, so it never includes the
    /// reader — "3 people have reported cancelled" when one of them is you reads as three
    /// strangers agreeing with you, which overstates the evidence by one.
    public var othersLine: String? {
        let others = myStance == .cancelled ? reportCount - 1 : reportCount
        guard others > 0 else { return nil }
        if myStance == nil {
            return others == 1
                ? "1 person has reported cancelled"
                : "\(others) people have reported cancelled"
        }
        return others == 1
            ? "1 other has reported cancelled"
            : "\(others) others have reported cancelled"
    }

    /// People contradicting the cancellation reports. Only worth saying when there is
    /// something to contradict.
    public var disputedLine: String? {
        guard onCount > 0, reportCount > 0 else { return nil }
        return onCount == 1
            ? "1 person says it went ahead"
            : "\(onCount) people say it went ahead"
    }

    public init(reportCount: Int,
                onCount: Int = 0,
                myStance: ReportStance? = nil,
                verdict: EventVerdict? = nil) {
        self.reportCount = reportCount
        self.onCount = onCount
        self.myStance = myStance
        self.verdict = verdict
    }
}

public enum CancellationRules {
    /// Independent devices that must report a class cancelled before it is worth flagging.
    public static let threshold = 3

    /// How far ahead the cancellation reports must stay once contradictions are subtracted.
    /// Lower than `threshold` on purpose: reaching three reports is the hard part, and
    /// demanding a clear three after subtraction would let a single mistaken "it was on"
    /// bury a real cancellation. See `CancellationStatus.isFlagged`.
    public static let netThreshold = 2

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
        statuses(from: reports.filter { $0.eventKey == key },
                 reporterID: reporterID,
                 verdicts: verdict.map { [$0] } ?? [])[key]
            ?? CancellationStatus(reportCount: 0, verdict: verdict)
    }

    /// Build statuses from server-side tallies. Same precedence as the report-based
    /// version below, which stays for the local fallback store and for the pure tests.
    public static func statuses(from tallies: [CancellationTally],
                                verdicts: [EventVerdict] = []) -> [String: CancellationStatus] {
        let byKey = Dictionary(verdicts.map { ($0.eventKey, $0) }) { first, _ in first }
        var result: [String: CancellationStatus] = [:]
        for tally in tallies {
            result[tally.eventKey] = CancellationStatus(reportCount: tally.reportCount,
                                                        onCount: tally.onCount,
                                                        myStance: tally.myStance,
                                                        verdict: byKey[tally.eventKey])
        }
        // A verdict on a class nobody reported has no tally row to decorate.
        for (key, verdict) in byKey where result[key] == nil {
            result[key] = CancellationStatus(reportCount: 0, verdict: verdict)
        }
        return result
    }

    public static func statuses(from reports: [CancellationReport],
                                reporterID: String,
                                verdicts: [EventVerdict] = []) -> [String: CancellationStatus] {
        /// One vote per person per class, so a device that somehow holds two rows for the
        /// same key counts once — on whichever side it last claimed.
        var byKey: [String: [String: ReportStance]] = [:]
        for report in reports.sorted(by: { $0.reportedAt < $1.reportedAt }) {
            byKey[report.eventKey, default: [:]][report.reporterID] = report.stance
        }
        let verdictsByKey = Dictionary(verdicts.map { ($0.eventKey, $0) }) { first, _ in first }

        var result = byKey.mapValues { votes in
            CancellationStatus(reportCount: votes.values.filter { $0 == .cancelled }.count,
                               onCount: votes.values.filter { $0 == .on }.count,
                               myStance: votes[reporterID],
                               verdict: nil)
        }
        // A verdict on a class nobody reported still has to appear, so this walks the
        // verdicts rather than only decorating rows the crowd happened to create.
        for (key, verdict) in verdictsByKey {
            let existing = result[key]
            result[key] = CancellationStatus(reportCount: existing?.reportCount ?? 0,
                                             onCount: existing?.onCount ?? 0,
                                             myStance: existing?.myStance,
                                             verdict: verdict)
        }
        return result
    }
}
