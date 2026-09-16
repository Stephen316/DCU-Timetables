import Foundation

/// A DCU campus.
public enum Campus: String, Sendable, Equatable, CaseIterable {
    case glasnevin
    case stPatricks
    case allHallows

    init?(code: String) {
        switch code.uppercased() {
        case "GLA": self = .glasnevin
        case "SPC", "SPD": self = .stPatricks
        case "AHC": self = .allHallows
        default: return nil
        }
    }

    public var name: String {
        switch self {
        case .glasnevin:  return "Glasnevin"
        case .stPatricks: return "St Patrick's"
        case .allHallows: return "All Hallows"
        }
    }
}

/// A parsed DCU room code such as `GLA.FT301`.
///
/// The format is **campus . building + floor + room** — e.g. `GLA.CG86` is Glasnevin,
/// Henry Grattan (C), Ground floor, room 86; `GLA.FT301` is Polaris (FT), floor 3, room 301.
/// Building names are only mapped for Glasnevin; anything unrecognised keeps its raw code
/// rather than inventing a name.
public struct RoomLocation: Equatable, Sendable {
    public enum Floor: Equatable, Sendable {
        case ground, basement, mezzanine
        case numbered(Int)

        public var label: String {
            switch self {
            case .ground:           return "Ground floor"
            case .basement:         return "Basement"
            case .mezzanine:        return "Mezzanine"
            case .numbered(let n):  return "Floor \(n)"
            }
        }
    }

    public let raw: String
    public let campus: Campus?
    /// The room code with the campus prefix removed, e.g. "FT301".
    public let code: String
    public let buildingCode: String?
    public let buildingName: String?
    public let floor: Floor?
    public let room: String?

    // Glasnevin building codes (DCU campus guide). Longer codes must be matched first.
    private static let glasnevinBuildings: [String: String] = [
        "A": "Albert College", "B": "Invent", "C": "Henry Grattan",
        "CA": "Henry Grattan Extension", "D": "BEA Orpen", "E": "Estates Office",
        "F": "Multi-storey Car Park", "FT": "Polaris", "G": "NICB",
        "GA": "Nano Research Facility", "H": "Nursing Building", "J": "Hamilton",
        "KA": "The U (Student Centre)", "L": "McNulty", "M": "Interfaith Centre",
        "N": "Marconi", "P": "Pavilion", "PR": "Restaurant", "Q": "DCU Business School",
        "QA": "MacCormac", "R": "Créche", "S": "Stokes", "SA": "Stokes Extension",
        "T": "Terence Larkin Theatre", "U": "DCU Sport", "X": "Lonsdale",
        "Y": "O'Reilly Library", "Z": "The Helix",
        "IFSC": "DCU Business School", "KPMG": "DCU Business School", "SPORTS": "DCU Sport",
    ]

    public init(_ raw: String) {
        self.raw = raw
        let trimmed = raw.trimmingCharacters(in: .whitespaces)

        // Campus prefix before the "." — dropped from the displayed code.
        var body = trimmed
        var campus: Campus?
        if let dot = trimmed.firstIndex(of: ".") {
            campus = Campus(code: String(trimmed[..<dot]))
            body = String(trimmed[trimmed.index(after: dot)...])
        }
        self.campus = campus
        self.code = body

        // Parse structure from the leading token (handles "XG28 & XG28-A").
        let token = body.split(whereSeparator: { $0 == " " || $0 == "&" }).first.map(String.init) ?? body
        let upper = token.uppercased()

        // Longest building code first, so CA/SA/FT win over C/S/F.
        let known = Self.glasnevinBuildings.keys.sorted { $0.count > $1.count }
        let building = known.first { upper.hasPrefix($0) }
        self.buildingCode = building
        self.buildingName = (campus == .glasnevin || campus == nil)
            ? building.flatMap { Self.glasnevinBuildings[$0] } : nil

        var rest = Substring(upper)
        if let building { rest = rest.dropFirst(building.count) }

        // Optional floor letter, then the room digits (first digit is the floor).
        var floor: Floor?
        if let first = rest.first {
            switch first {
            case "G": floor = .ground;    rest = rest.dropFirst()
            case "B": floor = .basement;  rest = rest.dropFirst()
            case "M": floor = .mezzanine; rest = rest.dropFirst()
            default: break
            }
        }
        let digits = rest.prefix { $0.isNumber }
        self.room = digits.isEmpty ? nil : String(digits)
        if floor == nil, let firstDigit = digits.first, let n = Int(String(firstDigit)) {
            floor = .numbered(n)
        }
        self.floor = floor
    }

    /// "Polaris, Room 301, Floor 3" — the readable location, never the raw room code.
    /// Falls back to the code only when the building can't be identified (non-Glasnevin
    /// campuses), because there is nothing truthful to show in its place.
    public var displayText: String {
        guard let buildingName else { return code }
        var parts = [buildingName]
        if let room { parts.append("Room \(room)") }
        if let floor { parts.append(floor.label) }
        return parts.joined(separator: ", ")
    }

    /// "Polaris, Room 301" — used when one class spans several rooms, to keep the row short.
    public var shortText: String {
        guard let buildingName else { return code }
        guard let room else { return buildingName }
        return "\(buildingName), Room \(room)"
    }
}

public extension TimetableEvent {
    var parsedLocations: [RoomLocation] { locations.map(RoomLocation.init) }

    /// Readable room text: full detail for a single room, name + room for several.
    var locationDisplay: String {
        let parsed = parsedLocations
        guard !parsed.isEmpty else { return "—" }
        if parsed.count == 1 { return parsed[0].displayText }
        return parsed.map(\.shortText).joined(separator: " · ")
    }
}
