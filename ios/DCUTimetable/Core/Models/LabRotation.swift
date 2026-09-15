import Foundation

/// One lab session in the Year-1 Engineering rotation (which groups attend which lab on
/// a given date). Sourced from the School of Engineering's published rotation — the
/// public timetable API does not expose this group-by-week detail. Contains no personal
/// data.
public struct LabSession: Codable, Identifiable, Sendable, Equatable {
    public let week: Int
    public let date: String        // ISO yyyy-MM-dd
    public let day: String         // "Tue"
    public let start: String       // "14:00"
    public let end: String         // "17:00"
    public let module: String      // "EEG1001"
    public let groups: [String]    // ["B"]

    public var id: String { "\(module)-\(date)-\(start)" }
}

/// The bundled rotation schedule.
public struct LabRotation: Codable, Sendable {
    public struct ModuleInfo: Codable, Sendable, Equatable {
        public let name: String
        public let activity: String   // "Workshop", "Drawing", "Programming lab"
    }

    public let title: String
    public let modules: [String: ModuleInfo]
    public let sessions: [LabSession]

    /// Group letters referenced anywhere in the rotation, e.g. ["A","B","C","D","E"].
    public var groupLetters: [String] {
        Set(sessions.flatMap { $0.groups }).sorted()
    }

    /// The module codes this rotation covers (used to tell if a student is on it).
    public var moduleCodes: Set<String> { Set(modules.keys) }

    /// Sessions a given group attends, in schedule order.
    public func sessions(forGroup group: String) -> [LabSession] {
        sessions
            .filter { $0.groups.contains(group) }
            .sorted { ($0.week, $0.start) < ($1.week, $1.start) }
    }

    public func activity(for moduleCode: String) -> String {
        modules[moduleCode]?.activity ?? moduleCode
    }
    public func name(for moduleCode: String) -> String {
        modules[moduleCode]?.name ?? moduleCode
    }
}

public enum LabRotationLoader {
    /// Loads the rotation bundled with the app (no personal data).
    public static func bundled(in bundle: Bundle = .main) -> LabRotation? {
        guard let url = bundle.url(forResource: "EngineeringLabRotation", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(LabRotation.self, from: data)
    }
}

// MARK: - Surname → group (personal data; loaded locally, never shipped)

/// One student's engineering group allocation. Loaded only from a file the user imports
/// into the app's Documents directory — never bundled or committed (see .gitignore).
public struct EngGroupRecord: Codable, Sendable, Equatable {
    public let name: String
    public let group: String       // "A"
    public let subgroup: String    // "A.1"
    public let day: String
    public let workshop: String
    public let drawing: String
}

/// Looks up a student's group by surname from a locally-imported directory.
public enum EngGroupDirectory {
    private struct File: Codable { let bySurname: [String: [EngGroupRecord]] }

    /// Where the imported directory is stored (always the same path in Documents).
    public static func documentsFileURL() -> URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("eng_groups.json")
    }

    /// The stored directory URL, or nil if nothing has been imported.
    public static func fileURL() -> URL? {
        guard let url = documentsFileURL(), FileManager.default.fileExists(atPath: url.path)
        else { return nil }
        return url
    }

    public static var isAvailable: Bool { fileURL() != nil }

    /// Records matching a surname (case-insensitive). Empty if no directory or no match.
    public static func lookup(surname: String) -> [EngGroupRecord] {
        let key = surname.trimmingCharacters(in: .whitespaces).lowercased()
        guard !key.isEmpty,
              let url = fileURL(),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data)
        else { return [] }
        return file.bySurname[key] ?? []
    }

    /// Imports a class list and stores it locally. Accepts JSON (`{"bySurname": …}`) or a
    /// readable table (Markdown / CSV / TSV) with columns Surname, First Name, Group,
    /// optional Sub-group, Day, Workshop, Drawing. Returns the number of students imported.
    @discardableResult
    public static func importFile(at url: URL) throws -> Int {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let data = try Data(contentsOf: url)
        let bySurname: [String: [EngGroupRecord]]
        if url.pathExtension.lowercased() == "json", let f = try? JSONDecoder().decode(File.self, from: data) {
            bySurname = f.bySurname
        } else if let text = String(data: data, encoding: .utf8) {
            bySurname = parseTable(text)
        } else {
            throw error("Couldn't read the file as text.")
        }
        guard !bySurname.isEmpty else {
            throw error("No student rows found. Expected columns: Surname, First Name, Group, Day, Workshop, Drawing.")
        }
        guard let dest = documentsFileURL() else { throw error("No Documents folder available.") }
        try JSONEncoder().encode(File(bySurname: bySurname)).write(to: dest, options: .atomic)
        return Set(bySurname.values.flatMap { $0 }.map(\.name)).count
    }

    /// Removes the imported directory.
    public static func clear() {
        if let url = fileURL() { try? FileManager.default.removeItem(at: url) }
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "EngGroupDirectory", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    /// Parses a Markdown/CSV/TSV table into a surname → records index.
    static func parseTable(_ text: String) -> [String: [EngGroupRecord]] {
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        guard let headerIdx = lines.firstIndex(where: { $0.lowercased().contains("surname") }) else { return [:] }

        let headerLine = lines[headerIdx]
        let delim: Character = headerLine.contains("|") ? "|" : (headerLine.contains("\t") ? "\t" : ",")

        func cells(_ line: String) -> [String] {
            var parts = line.split(separator: delim, omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            if delim == "|" {                       // markdown rows are wrapped in pipes
                if parts.first == "" { parts.removeFirst() }
                if parts.last == "" { parts.removeLast() }
            }
            return parts
        }

        let header = cells(headerLine).map { $0.lowercased() }
        func col(_ needles: [String]) -> Int? {
            header.firstIndex { h in needles.contains { h.contains($0) } }
        }
        let iSur = col(["surname"]) ?? 0
        let iFirst = col(["first"])
        let iSub = col(["sub"])
        let iGroup = col(["group"]) ?? iSub
        let iDay = col(["day"]); let iWork = col(["workshop"]); let iDraw = col(["drawing"])

        var out: [String: [EngGroupRecord]] = [:]
        for line in lines[(headerIdx + 1)...] {
            let c = cells(line)
            guard iSur < c.count else { continue }
            let surname = c[iSur]
            if surname.isEmpty || surname.allSatisfy({ $0 == "-" }) { continue }   // header rule / blank

            func value(_ i: Int?) -> String { if let i, i < c.count { return c[i] }; return "" }
            let groupRaw = value(iGroup)
            let subRaw = value(iSub).isEmpty ? groupRaw : value(iSub)
            let letter = String(groupRaw.prefix { $0 != "." }).trimmingCharacters(in: .whitespaces)
            guard !letter.isEmpty else { continue }

            let first = value(iFirst)
            let record = EngGroupRecord(
                name: [surname, first].filter { !$0.isEmpty }.joined(separator: " "),
                group: letter,
                subgroup: subRaw,
                day: value(iDay),
                workshop: value(iWork),
                drawing: value(iDraw)
            )
            let firstToken = surname.split(separator: " ").first.map { String($0) } ?? surname
            for key in Set([surname.lowercased(), firstToken.lowercased()]) {
                out[key, default: []].append(record)
            }
        }
        return out
    }
}
