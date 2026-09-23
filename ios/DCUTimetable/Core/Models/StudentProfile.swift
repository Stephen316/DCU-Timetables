import Foundation

/// A student's profile, created on first launch by matching their verified DCU address
/// against the class list an admin uploaded — on the server, by `resolve_allocation`
/// (supabase/phase13_roster_allocations.sql). For now the only supported cohort is Year-1
/// Engineering (lab group → the common EEG module set + their lab rotation).
public struct StudentProfile: Codable, Equatable, Sendable {
    public enum Cohort: String, Codable, Sendable, CaseIterable {
        case engineeringYear1

        /// The programme key the console saves this cohort's class list under. A class list
        /// for any other key has no timetable here to drive, so the app does not offer it.
        public var courseKey: String {
            switch self {
            case .engineeringYear1: return "EEG1"
            }
        }

        public init?(courseKey: String) {
            guard let match = Self.allCases.first(where: { $0.courseKey == courseKey }) else { return nil }
            self = match
        }
    }

    public let name: String
    public let cohort: Cohort
    public let group: String        // lab group letter, e.g. "D"
    public let subgroup: String     // e.g. "D.1"
    public let workshop: String     // room, e.g. "SG23"
    public let drawing: String      // room, e.g. "SB39"

    /// Where the allocation came from, so a re-imported class list can be noticed and the
    /// profile re-resolved. Nil on profiles made before the server matched them, which
    /// keep working unchanged — they just never refresh.
    public let courseKey: String?
    public let allocationKey: String?
    public let rosterVersion: Int?

    public init(name: String, cohort: Cohort = .engineeringYear1,
                group: String, subgroup: String = "", workshop: String = "", drawing: String = "",
                courseKey: String? = nil, allocationKey: String? = nil, rosterVersion: Int? = nil) {
        self.name = name
        self.cohort = cohort
        self.group = group
        self.subgroup = subgroup
        self.workshop = workshop
        self.drawing = drawing
        self.courseKey = courseKey
        self.allocationKey = allocationKey
        self.rosterVersion = rosterVersion
    }

    /// Built from what the server resolved. The name is the one from the student's own
    /// address — the class list's copy of it never reaches the device.
    public init(name: String, cohort: Cohort, allocation: Allocation, allocationKey: String, rosterVersion: Int) {
        self.init(name: name, cohort: cohort,
                  group: allocation.group,
                  subgroup: allocation.subgroup ?? "",
                  workshop: allocation.workshop ?? "",
                  drawing: allocation.drawing ?? "",
                  courseKey: cohort.courseKey,
                  allocationKey: allocationKey,
                  rosterVersion: rosterVersion)
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
