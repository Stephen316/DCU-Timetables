import Foundation

/// What a signed-in account is allowed to do. Mirrors the `app_role` enum in
/// `supabase/phase0_identity.sql`.
///
/// This is a *hint for the UI only*. Every one of these permissions is enforced by
/// row-level security in the database, because a role cached on a device is a role a
/// determined person can edit. Hiding a button is presentation; the policy is the rule.
public enum AppRole: String, Codable, Sendable, CaseIterable {
    case student, trusted, admin

    /// May post definitive verdicts and verify deadlines.
    public var canDecide: Bool { self == .trusted || self == .admin }

    /// May grant trust, ban, and import in bulk.
    public var canAdminister: Bool { self == .admin }

    public var label: String {
        switch self {
        case .student: return "Student"
        case .trusted: return "Trusted"
        case .admin:   return "Admin"
        }
    }
}

/// The signed-in account's row in `profiles`.
public struct AccountProfile: Codable, Sendable, Equatable {
    public let id: String
    public let role: AppRole
    /// The shareable identifier (`PublicIdentifier`). Optional because the row exists
    /// before the id is allocated — a profile without one is not an error, just new.
    public let pi: String?
    public let displayName: String?
    public let bannedUntil: Date?

    public init(id: String, role: AppRole = .student, pi: String? = nil,
                displayName: String? = nil, bannedUntil: Date? = nil) {
        self.id = id
        self.role = role
        self.pi = pi
        self.displayName = displayName
        self.bannedUntil = bannedUntil
    }

    public func isBanned(at now: Date = Date()) -> Bool {
        guard let bannedUntil else { return false }
        return bannedUntil > now
    }

    /// A banned account keeps its role in the database but must not act on it, so the
    /// two checks are never asked separately at a call site.
    public func canDecide(at now: Date = Date()) -> Bool {
        role.canDecide && !isBanned(at: now)
    }

    public func canAdminister(at now: Date = Date()) -> Bool {
        role.canAdminister && !isBanned(at: now)
    }
}

/// The identifier a student shares to be made trusted: one letter and six digits.
public enum PublicIdentifier {
    /// I and O are absent on purpose. Read aloud or retyped they are 1 and 0, and this
    /// string's whole job is to survive being sent to someone in a message. Must match
    /// the alphabet in `public.new_pi()`.
    public static let letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"

    /// Uppercases and strips the separators people add when copying by hand — spaces,
    /// hyphens — so "k-482 913" and "K482913" are the same identifier. Returns nil when
    /// what's left isn't one.
    public static func normalised(_ raw: String) -> String? {
        let stripped = raw.uppercased().filter { !" -–—_".contains($0) }
        return isValid(stripped) ? stripped : nil
    }

    public static func isValid(_ candidate: String) -> Bool {
        guard candidate.count == 7, let first = candidate.first else { return false }
        return letters.contains(first) && candidate.dropFirst().allSatisfy(\.isASCIIDigit)
    }
}

private extension Character {
    /// `isNumber` is true for "٣" and "Ⅳ"; the identifier is ASCII digits only.
    var isASCIIDigit: Bool { isASCII && isNumber }
}
