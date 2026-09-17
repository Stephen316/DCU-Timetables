import Foundation

/// A member of staff named on a class.
///
/// The timetable API gives a name and nothing else. DCU publishes staff photos on
/// individual school and research-centre pages rather than through one directory or API,
/// so there is no URL that can be derived from a name — a photo only appears for staff
/// listed in the optional bundled `lecturers.json`. Everyone else gets initials, which is
/// honest rather than a broken image.
public struct Lecturer: Identifiable, Equatable, Sendable {
    public var id: String { name }
    public let name: String
    public let photoURL: URL?
    public let role: String?

    public init(name: String, photoURL: URL? = nil, role: String? = nil) {
        self.name = name
        self.photoURL = photoURL
        self.role = role
    }

    /// The API writes staff surname-first ("Harcourt, Stephen"); people read the other way.
    public var displayName: String {
        let parts = name.split(separator: ",", maxSplits: 1).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        guard parts.count == 2, !parts[1].isEmpty else { return name.trimmingCharacters(in: .whitespaces) }
        return "\(parts[1]) \(parts[0])"
    }

    /// Up to two letters for the fallback avatar.
    public var initials: String {
        let words = displayName.split(whereSeparator: { $0 == " " || $0 == "-" })
        let letters = words.compactMap { $0.first(where: \.isLetter) }
        guard let first = letters.first else { return "?" }
        if let last = letters.count > 1 ? letters.last : nil {
            return String([first, last]).uppercased()
        }
        return String(first).uppercased()
    }
}

/// Optional extra detail about staff, loaded from a bundled `lecturers.json`:
/// `[{"name": "Harcourt, Stephen", "photo": "https://…", "role": "Assistant Professor"}]`.
/// Absent file means every lecturer shows initials.
public enum LecturerDirectory {
    private struct Entry: Decodable {
        let name: String
        let photo: String?
        let role: String?
    }

    private static var entries: [String: Entry] = load()

    private static func load(bundle: Bundle = .main) -> [String: Entry] {
        guard let url = bundle.url(forResource: "lecturers", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data) else { return [:] }
        return Dictionary(decoded.map { (normalise($0.name), $0) }, uniquingKeysWith: { first, _ in first })
    }

    private static func normalise(_ name: String) -> String {
        name.lowercased().filter { $0.isLetter || $0.isWhitespace }
            .split(separator: " ").sorted().joined(separator: " ")
    }

    /// Matches on the name parts regardless of order, so "Harcourt, Stephen" and
    /// "Stephen Harcourt" find the same person.
    public static func lecturer(named name: String) -> Lecturer {
        let entry = entries[normalise(name)]
        return Lecturer(name: name,
                        photoURL: entry?.photo.flatMap(URL.init(string:)),
                        role: entry?.role)
    }

    public static func lecturers(for event: TimetableEvent) -> [Lecturer] {
        event.staff.map(lecturer(named:))
    }
}
