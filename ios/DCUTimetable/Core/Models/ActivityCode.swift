import Foundation

/// Parses a DCU activity code such as `BIO1000[1]OC/L1/01 Surname A - M` into its parts.
///
/// ```
/// BIO1000        module code
/// [1]            occurrence / semester
/// OC             delivery (OC on-campus, AY async, SY sync, …)
/// L1             activity kind (L/T/P/S/W) + index
/// 01             group number
/// Surname A - M  cohort label (splits a large class into groups)
/// ```
///
/// The group number and cohort are what identify a *student's* stream, which drives
/// group-filtering and clash detection. Parsing is defensive: unknown shapes keep `raw`
/// and fall back to `.other`.
public struct ActivityCode: Equatable, Sendable, Codable {
    public let raw: String
    public let moduleCode: String?
    public let occurrence: String?
    public let delivery: String?
    public let kind: Kind
    public let activityIndex: Int?
    public let group: String?
    public let cohort: String?

    public enum Kind: String, Sendable, Equatable, Codable {
        case lecture = "L"
        case tutorial = "T"
        case practical = "P"
        case seminar = "S"
        case workshop = "W"
        case other = "?"

        public var label: String {
            switch self {
            case .lecture:   return "Lecture"
            case .tutorial:  return "Tutorial"
            case .practical: return "Lab"
            case .seminar:   return "Seminar"
            case .workshop:  return "Workshop"
            case .other:     return "Class"
            }
        }
    }

    public init(_ name: String) {
        self.raw = name
        let trimmed = name.trimmingCharacters(in: .whitespaces)

        // Split "code cohort" on the first space.
        var codePart: String
        if let space = trimmed.firstIndex(of: " ") {
            codePart = String(trimmed[..<space])
            let rest = trimmed[trimmed.index(after: space)...]
                .trimmingCharacters(in: .whitespaces)
            // A cross-listed module reads like "CHM1006[1]OC/L1/01, EEG1017[1]OC/L1/01" —
            // the text after the space is a second activity code, not a cohort. Real
            // cohorts read like "Surname A - M" and contain no "[" or "/".
            if rest.contains("[") || rest.contains("/") {
                self.cohort = nil
            } else {
                self.cohort = rest.isEmpty ? nil : rest
            }
        } else {
            codePart = trimmed
            self.cohort = nil
        }
        // Drop a trailing comma left by a cross-listed code (".../01," → ".../01").
        codePart = codePart.trimmingCharacters(in: CharacterSet(charactersIn: ","))

        let segs = codePart.split(separator: "/").map(String.init)

        // Segment 0: module[occurrence]delivery
        var module: String?, occ: String?, delivery: String?
        if let s0 = segs.first {
            if let lb = s0.firstIndex(of: "["), let rb = s0.firstIndex(of: "]") {
                module = String(s0[..<lb])
                occ = String(s0[s0.index(after: lb)..<rb])
                let after = s0[s0.index(after: rb)...]
                delivery = after.isEmpty ? nil : String(after)
            } else {
                module = s0
            }
        }
        self.moduleCode = (module?.isEmpty == false) ? module : nil
        self.occurrence = (occ?.isEmpty == false) ? occ : nil
        self.delivery = delivery

        // Segment 1: activity kind + index (e.g. "L1")
        var kind: Kind = .other
        var index: Int?
        if segs.count > 1 {
            let s1 = segs[1]
            let letters = s1.prefix { $0.isLetter }
            let digits = s1.drop { $0.isLetter }
            if let first = letters.first {
                kind = Kind(rawValue: String(first).uppercased()) ?? .other
            }
            index = Int(digits)
        }
        self.kind = kind
        self.activityIndex = index

        // Segment 2: group number
        self.group = segs.count > 2 ? segs[2] : nil
    }

    /// A short human label, e.g. "Lecture · Group 01".
    public var summary: String {
        var parts = [kind.label]
        if let group { parts.append("Group \(group)") }
        return parts.joined(separator: " · ")
    }
}
