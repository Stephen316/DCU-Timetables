import Foundation

/// A deadline one student has shared with everyone taking the module.
///
/// Deadlines belong to the **module**, not to one occurrence of a class: an assignment set
/// in Monday's lecture is the same assignment seen from Thursday's lab.
public struct Deadline: Identifiable, Codable, Sendable, Equatable {
    public let id: String
    public let moduleKey: String
    /// The class it's due at — a `TimetableEvent.groupKey`, e.g. this student's Practical
    /// P2. Only that class shows it at the top of its page and gets a border on the day;
    /// every class in the module still lists it at the bottom. `nil` means module-wide.
    public let atGroupKey: String?
    public let title: String
    public let due: Date
    public let kind: DeadlineKind
    /// Who submitted it — the same anonymous id used for cancellation reports, so a student
    /// can delete their own without anyone being named.
    public let submitterID: String
    public let submittedAt: Date

    public init(id: String = UUID().uuidString,
                moduleKey: String,
                atGroupKey: String? = nil,
                title: String,
                due: Date,
                kind: DeadlineKind = .assignment,
                submitterID: String,
                submittedAt: Date = Date()) {
        self.id = id
        self.moduleKey = moduleKey
        self.atGroupKey = atGroupKey
        self.title = title
        self.due = due
        self.kind = kind
        self.submitterID = submitterID
        self.submittedAt = submittedAt
    }
}

public enum DeadlineKind: String, Codable, CaseIterable, Sendable {
    case assignment, labReport, quiz, exam, presentation, other

    /// Sat in the room (a quiz or an exam) rather than handed in. The two are flagged
    /// differently because missing one is unrecoverable.
    public var isSatInClass: Bool {
        self == .quiz || self == .exam
    }

    public var label: String {
        switch self {
        case .assignment: return "Assignment"
        case .labReport: return "Lab report"
        case .quiz: return "Quiz"
        case .exam: return "Exam"
        case .presentation: return "Presentation"
        case .other: return "Other"
        }
    }

    public var symbol: String {
        switch self {
        case .assignment: return "doc.text"
        case .labReport: return "flask"
        case .quiz: return "checklist"
        case .exam: return "graduationcap"
        case .presentation: return "person.wave.2"
        case .other: return "calendar"
        }
    }
}

/// One student vouching that a deadline is right. Same shape as a cancellation report:
/// anonymous, one per person, withdrawable.
public struct DeadlineConfirmation: Codable, Sendable, Equatable {
    public let deadlineID: String
    public let confirmerID: String

    public init(deadlineID: String, confirmerID: String) {
        self.deadlineID = deadlineID
        self.confirmerID = confirmerID
    }
}

/// How much agreement a deadline has, and whether this student is part of it.
public struct DeadlineStanding: Sendable, Equatable {
    /// Everyone vouching for it, including whoever submitted it.
    public let confirmCount: Int
    public let confirmedByMe: Bool

    /// The threshold only decides whether it's *flagged* as confirmed — the count itself
    /// keeps climbing and is always shown in full.
    public var isConfirmed: Bool { confirmCount >= DeadlineRules.confirmThreshold }

    /// Always the real number, never "x of 3": a deadline eleven people have confirmed is
    /// more trustworthy than one three have, and capping the wording hides that.
    public var summary: String {
        switch confirmCount {
        case ..<1: return "Nobody has confirmed this yet"
        case 1: return "1 person has confirmed"
        default: return "\(confirmCount) people have confirmed"
        }
    }

    public init(confirmCount: Int, confirmedByMe: Bool) {
        self.confirmCount = confirmCount
        self.confirmedByMe = confirmedByMe
    }
}

/// Why a class is outlined in the timetable. Ordered by how much it matters: a class that
/// isn't running outranks a quiz, which outranks something to hand in.
public enum ClassHighlight: Sendable, Equatable {
    case cancelled(reportCount: Int)
    case test(title: String)
    case assignment(title: String)

    public var reason: String {
        switch self {
        case .cancelled(let count): return "Reported not on · \(count) people"
        case .test(let title): return "\(title) today"
        case .assignment(let title): return "\(title) due today"
        }
    }
}

public enum DeadlineRules {
    /// People who must vouch for a deadline before it's shown as confirmed. Submitting
    /// counts as the first vouch, so this is the submitter plus two others — deliberately
    /// lower than the cancellation threshold, because a wrong deadline is visible and
    /// arguable in a way a wrongly-flagged empty room isn't.
    public static let confirmThreshold = 3

    /// Which module's noticeboard a class shares. Falls back to the raw activity code for
    /// anything the module code can't be read from, so those events get their own board
    /// rather than being pooled together.
    public static func moduleKey(for event: TimetableEvent) -> String {
        event.moduleCode ?? event.activity.raw
    }

    /// Soonest first, and anything already past dropped — a noticeboard of last term's
    /// deadlines is just noise.
    public static func upcoming(_ deadlines: [Deadline], now: Date = Date()) -> [Deadline] {
        deadlines.filter { $0.due >= now }.sorted { $0.due < $1.due }
    }

    /// A submission is only accepted with a real title and a due date in the future.
    public static func isValid(title: String, due: Date, now: Date = Date()) -> Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && due > now
    }

    /// Does this deadline belong to this exact class on this exact day?
    ///
    /// Same module, same calendar day as the due date, and either pinned to this class's
    /// group or not pinned at all. The day has to match exactly — an assignment due Friday
    /// must not colour Monday's lecture.
    public static func isDue(_ deadline: Deadline, at event: TimetableEvent,
                             calendar: Calendar = .current) -> Bool {
        guard deadline.moduleKey == moduleKey(for: event),
              calendar.isDate(deadline.due, inSameDayAs: event.start) else { return false }
        guard let pinned = deadline.atGroupKey else { return true }
        return pinned == event.groupKey
    }

    /// Everything due at this class today, soonest first.
    public static func due(at event: TimetableEvent, from deadlines: [Deadline],
                           calendar: Calendar = .current) -> [Deadline] {
        deadlines.filter { isDue($0, at: event, calendar: calendar) }.sorted { $0.due < $1.due }
    }

    /// What (if anything) to outline this class with.
    public static func highlight(for event: TimetableEvent,
                                 deadlines: [Deadline],
                                 cancellation: CancellationStatus,
                                 calendar: Calendar = .current) -> ClassHighlight? {
        if cancellation.isFlagged { return .cancelled(reportCount: cancellation.reportCount) }
        let today = due(at: event, from: deadlines, calendar: calendar)
        if let test = today.first(where: { $0.kind.isSatInClass }) {
            return .test(title: test.title)
        }
        if let first = today.first { return .assignment(title: first.title) }
        return nil
    }

    /// Tally confirmations for every deadline in one pass, keyed by deadline id.
    public static func standings(from confirmations: [DeadlineConfirmation],
                                 confirmerID: String) -> [String: DeadlineStanding] {
        var byDeadline: [String: Set<String>] = [:]
        for confirmation in confirmations {
            byDeadline[confirmation.deadlineID, default: []].insert(confirmation.confirmerID)
        }
        return byDeadline.mapValues {
            DeadlineStanding(confirmCount: $0.count, confirmedByMe: $0.contains(confirmerID))
        }
    }

    /// "in 3 days", "tomorrow", "today" — the phrasing students actually think in.
    public static func countdown(to due: Date, from now: Date = Date(),
                                 calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day],
                                           from: calendar.startOfDay(for: now),
                                           to: calendar.startOfDay(for: due)).day ?? 0
        switch days {
        case ..<0: return "overdue"
        case 0: return "today"
        case 1: return "tomorrow"
        default: return "in \(days) days"
        }
    }
}
