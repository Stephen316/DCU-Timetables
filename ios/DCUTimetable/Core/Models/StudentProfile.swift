import Foundation

/// A student's profile, created on first launch by entering their name and matching it
/// against the imported class list. For now the only supported cohort is Year-1
/// Engineering (name → lab group → the common EEG module set + their lab rotation).
public struct StudentProfile: Codable, Equatable, Sendable {
    public enum Cohort: String, Codable, Sendable {
        case engineeringYear1
    }

    public let name: String
    public let cohort: Cohort
    public let group: String        // lab group letter, e.g. "D"
    public let subgroup: String     // e.g. "D.1"
    public let workshop: String     // room, e.g. "SG23"
    public let drawing: String      // room, e.g. "SB39"

    public init(name: String, cohort: Cohort = .engineeringYear1,
                group: String, subgroup: String = "", workshop: String = "", drawing: String = "") {
        self.name = name
        self.cohort = cohort
        self.group = group
        self.subgroup = subgroup
        self.workshop = workshop
        self.drawing = drawing
    }

    /// First name for a friendly greeting ("Hi Luke").
    public var firstName: String {
        // Directory names are "Surname First …"; the given name is the second token.
        let parts = name.split(separator: " ")
        return parts.count >= 2 ? String(parts[1]) : name
    }
}

/// The bundled Year-1 Engineering module set (codes only; no personal data).
public struct EngineeringYear1: Codable, Sendable {
    public let title: String
    public let modules: [String]

    public static func bundled(in bundle: Bundle = .main) -> EngineeringYear1? {
        guard let url = bundle.url(forResource: "EngineeringYear1", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(EngineeringYear1.self, from: data)
    }
}
