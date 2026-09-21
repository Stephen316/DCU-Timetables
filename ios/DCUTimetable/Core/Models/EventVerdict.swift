import Foundation

/// What a trusted person has stated about one occurrence of a class.
public enum VerdictState: String, Codable, Sendable, CaseIterable {
    /// It isn't on.
    case cancelled
    /// It *is* on — the override for a false crowd flag. Without this, three mistaken
    /// reports could only be cleared by finding and deleting the reports themselves.
    case running
    /// On, but not where or when the timetable says.
    case moved
}

/// One definitive statement about a class, outranking any number of student reports.
///
/// This is a different kind of claim from a tally, not a louder one, and the UI must keep
/// them apart: "3 people say this isn't on" is a guess with weight behind it, "confirmed
/// off" is a fact with someone's name behind it. Showing them identically would waste the
/// trust signal and make one person's mistake look like a consensus.
public struct EventVerdict: Codable, Sendable, Equatable {
    /// Must equal `CancellationRules.eventKey(for:)` exactly — see docs/ADMIN_CONSOLE.md §6.
    public let eventKey: String
    public let state: VerdictState
    public let note: String?
    public let roomOverride: String?
    public let startOverride: Date?
    /// What students see as the source — "the class rep", "Dr Ryan's email". Never a name
    /// read from `profiles`: a verdict is visible to everyone, and those are admin-only.
    public let decidedByLabel: String?
    public let decidedAt: Date

    public init(eventKey: String,
                state: VerdictState,
                note: String? = nil,
                roomOverride: String? = nil,
                startOverride: Date? = nil,
                decidedByLabel: String? = nil,
                decidedAt: Date = Date()) {
        self.eventKey = eventKey
        self.state = state
        self.note = note
        self.roomOverride = roomOverride
        self.startOverride = startOverride
        self.decidedByLabel = decidedByLabel
        self.decidedAt = decidedAt
    }

    /// "an organiser" rather than nothing: an unattributed verdict still needs to read as
    /// coming from a person, or a student can't weigh it at all.
    public var source: String {
        let trimmed = decidedByLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else { return "an organiser" }
        return trimmed
    }

    public var headline: String {
        switch state {
        case .cancelled: return "Confirmed off by \(source)"
        case .running:   return "Confirmed on by \(source)"
        case .moved:     return "Moved by \(source)"
        }
    }
}
