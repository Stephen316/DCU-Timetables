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
    /// The column heading the session sits under in the School's PDF — "Workshop",
    /// "Drawing" or "Lab". Per session rather than per module, because one module has two:
    /// EEG1001 runs both the Workshop and the Drawing column.
    ///
    /// This used to live on the module, which cannot represent that. The data was bent to
    /// fit — Drawing was filed under EEG1004 — and 35 of 67 sessions carried the wrong
    /// module until 23 Sep 2026. See docs/ENGINEERING_LABS.md.
    public let activity: String
    public let groups: [String]    // ["B"]

    /// The activity is part of the identity because the module alone is not: EEG1001 holds
    /// a Workshop and a Drawing at the same hour on the same afternoon. Without it, the
    /// corrected rotation has 47 distinct ids for 67 sessions.
    public var id: String { "\(module)-\(activity)-\(date)-\(start)" }
}

/// The bundled rotation schedule.
public struct LabRotation: Codable, Sendable {
    public struct ModuleInfo: Codable, Sendable, Equatable {
        public let name: String
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
    ///
    /// By date, then time. This used to sort by week then time, which put a Friday 09:00
    /// lab ahead of the same week's Thursday 14:00 drawing class — a week's list read out
    /// of order for every group with a Friday morning. ISO dates sort correctly as strings.
    public func sessions(forGroup group: String) -> [LabSession] {
        sessions
            .filter { $0.groups.contains(group) }
            .sorted { ($0.date, $0.start) < ($1.date, $1.start) }
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
