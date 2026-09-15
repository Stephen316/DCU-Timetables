import Foundation

/// A searchable timetable object: a programme of study, a module, or a room.
public struct TimetableCategory: Identifiable, Equatable, Sendable, Hashable, Codable {
    public let identity: String            // UUID used in event requests
    public let name: String                // e.g. "AC1 (Chem & Pharma Science-1)"
    public let categoryTypeIdentity: String

    public var id: String { identity }

    public init(identity: String, name: String, categoryTypeIdentity: String) {
        self.identity = identity
        self.name = name
        self.categoryTypeIdentity = categoryTypeIdentity
    }

    /// The leading code, e.g. "AC1" from "AC1 (Chem & Pharma Science-1)".
    public var code: String {
        if let space = name.firstIndex(of: " ") { return String(name[..<space]) }
        return name
    }

    /// The descriptive part, e.g. "Chem & Pharma Science-1".
    public var descriptiveName: String {
        let stripped = name.drop(while: { $0 != " " }).trimmingCharacters(in: .whitespaces)
        return stripped
            .trimmingCharacters(in: CharacterSet(charactersIn: "()"))
            .trimmingCharacters(in: .whitespaces)
    }
}

/// The DCU category types (their GUIDs are fixed for the institution — see docs/API.md).
public enum CategoryType: String, Sendable {
    case programme = "241e4d36-60e0-49f8-b27e-99416745d98d"
    case module    = "525fe79b-73c3-4b5c-8186-83c652b3adcc"
    case location  = "1e042cb1-547d-41d4-ae93-a1f2c3d34538"
}
