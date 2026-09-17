import Foundation

/// A validated DCU address, and the student's name derived from it.
///
/// Only `@dcu.ie` and `@mail.dcu.ie` are accepted — the whole point is that a DCU address
/// (verified by a one-time code) proves the person is a student, so any other domain, or a
/// lookalike like `dcu.ie.example.com`, must be rejected.
///
/// The local part carries the name: `stephen.harcourt2` → Stephen Harcourt. Dots separate
/// the name, and a trailing disambiguation number is dropped.
public struct DCUEmail: Equatable, Sendable {
    public static let allowedDomains = ["dcu.ie", "mail.dcu.ie"]

    public let address: String
    /// Lowercased name parts in email order, e.g. ["stephen", "harcourt"].
    public let nameParts: [String]

    public var givenName: String { nameParts.first.map(Self.titleCased) ?? "" }
    public var familyName: String { nameParts.count > 1 ? Self.titleCased(nameParts[nameParts.count - 1]) : "" }
    /// "Stephen Harcourt"
    public var displayName: String { nameParts.map(Self.titleCased).joined(separator: " ") }

    public init?(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let pieces = trimmed.split(separator: "@", omittingEmptySubsequences: false)
        guard pieces.count == 2 else { return nil }

        let local = String(pieces[0])
        let domain = String(pieces[1])
        guard !local.isEmpty, Self.allowedDomains.contains(domain) else { return nil }

        // Dots separate names; a trailing number disambiguates duplicates and isn't part of
        // the name. Anything left without letters is not a name part.
        let parts = local
            .split(separator: ".")
            .map { $0.drop(while: { !$0.isLetter }) }
            .map { String($0.reversed().drop(while: \.isNumber).reversed()) }
            .filter { !$0.isEmpty && $0.contains(where: \.isLetter) }
        guard !parts.isEmpty else { return nil }

        self.address = trimmed
        self.nameParts = parts
    }

    private static func titleCased(_ part: String) -> String {
        guard let first = part.first else { return part }
        return first.uppercased() + part.dropFirst()
    }
}
