import Foundation

/// The lab rotation as saved in the console (`lab_rotations`, supabase/phase10), so a
/// correction reaches phones without a new build. The bundled JSON stays as the fallback:
/// first launch, offline, and a course with nothing saved.
public protocol LabRotationStore: Sendable {
    /// The saved rotation's version, or nil when nothing is saved for the course.
    func version(courseKey: String) async throws -> Int?
    func rotation(courseKey: String) async throws -> SavedLabRotation?
}

public struct SavedLabRotation: Equatable, Sendable {
    public let version: Int
    public let title: String?
    public let sessions: [LabSession]

    public init(version: Int, title: String?, sessions: [LabSession]) {
        self.version = version
        self.title = title
        self.sessions = sessions
    }

    /// Decodes PostgREST's one-row embed. A session missing its date, times, module or
    /// week can't be placed on a day, so it is left out rather than guessed at.
    public static func decode(_ data: Data) throws -> SavedLabRotation? {
        struct Session: Decodable {
            let week: Int?
            let date: String?
            let day: String?
            let start_time: String?
            let end_time: String?
            let module: String?
            let activity: String?
            let groups: [String]?
        }
        struct Row: Decodable {
            let version: Int
            let title: String?
            let lab_rotation_sessions: [Session]?
        }
        guard let row = try JSONDecoder().decode([Row].self, from: data).first else { return nil }
        let sessions = (row.lab_rotation_sessions ?? []).compactMap { s -> LabSession? in
            guard let week = s.week, let date = s.date, let start = s.start_time, let end = s.end_time,
                  let module = s.module, let groups = s.groups, !groups.isEmpty else { return nil }
            // Rotations saved before phase 12 have no activity. Left empty rather than
            // filled in: inventing one is how 35 sessions got the wrong module.
            return LabSession(week: week, date: date, day: s.day ?? "", start: start, end: end,
                              module: module, activity: s.activity ?? "", groups: groups)
        }
        return SavedLabRotation(version: row.version, title: row.title, sessions: sessions)
    }
}

public struct SupabaseLabRotationStore: LabRotationStore {
    private let config: SupabaseConfig
    private let session: URLSession

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func version(courseKey: String) async throws -> Int? {
        struct Row: Decodable { let version: Int }
        let data = try await get(courseKey: courseKey, select: "version")
        return try JSONDecoder().decode([Row].self, from: data).first?.version
    }

    public func rotation(courseKey: String) async throws -> SavedLabRotation? {
        try SavedLabRotation.decode(try await get(
            courseKey: courseKey,
            select: "version,title,lab_rotation_sessions(week,date,day,start_time,end_time,module,activity,groups)"))
    }

    private func get(courseKey: String, select: String) async throws -> Data {
        // Signed in or not at all. The tables are readable only by signed-in users, so the
        // anon key would get an empty answer — which reads as "nothing saved" and would
        // throw away a good cached rotation.
        guard let token = await SupabaseSession.shared.accessToken(config: config) else {
            throw AllocationStoreError.server(401)
        }
        var components = URLComponents(string: "\(config.url)/rest/v1/lab_rotations")!
        components.queryItems = [
            URLQueryItem(name: "select", value: select),
            URLQueryItem(name: "course_key", value: "eq.\(courseKey)"),
        ]
        var request = URLRequest(url: components.url!)
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw AllocationStoreError.server(http.statusCode)
        }
        return data
    }
}

/// The last rotation downloaded, on disk, so it survives a relaunch with no signal.
public struct LabRotationCache: Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let version: Int
        public let rotation: LabRotation
    }

    private let directory: URL

    public init(directory: URL? = nil) {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.directory = directory ?? base.appendingPathComponent("LabRotation", isDirectory: true)
        try? fileManager.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    public func entry(courseKey: String) -> Entry? {
        guard let data = try? Data(contentsOf: url(courseKey)) else { return nil }
        return try? JSONDecoder().decode(Entry.self, from: data)
    }

    public func store(_ entry: Entry, courseKey: String) {
        guard let data = try? JSONEncoder().encode(entry) else { return }
        try? data.write(to: url(courseKey), options: .atomic)
    }

    public func remove(courseKey: String) {
        try? FileManager.default.removeItem(at: url(courseKey))
    }

    private func url(_ courseKey: String) -> URL {
        directory.appendingPathComponent("\(courseKey.replacingOccurrences(of: "/", with: "_")).json")
    }
}

public enum LabRotationRefresh {
    /// Brings the cached rotation in step with the console. True when what the app shows
    /// has changed, so the timetable reloads.
    ///
    /// One small version fetch when nothing has changed. A failure of any kind keeps what
    /// is cached: offline must not swap a corrected rotation back to the bundled one.
    public static func run(courseKey: String, store: LabRotationStore, cache: LabRotationCache,
                           bundled: LabRotation?) async -> Bool {
        let cached = cache.entry(courseKey: courseKey)
        let version: Int?
        do {
            version = try await store.version(courseKey: courseKey)
        } catch {
            return false
        }
        guard let version else {
            // Deleted in the console: back to the bundled copy.
            guard cached != nil else { return false }
            cache.remove(courseKey: courseKey)
            return true
        }
        if cached?.version == version { return false }
        guard let saved = try? await store.rotation(courseKey: courseKey), !saved.sessions.isEmpty else {
            return false
        }
        cache.store(.init(version: saved.version, rotation: merge(saved, names: bundled)), courseKey: courseKey)
        return true
    }

    /// The console saves sessions, not module titles. Titles come from the bundled file,
    /// and a module it doesn't know shows its code.
    static func merge(_ saved: SavedLabRotation, names bundled: LabRotation?) -> LabRotation {
        var modules: [String: LabRotation.ModuleInfo] = [:]
        for code in Set(saved.sessions.map(\.module)) {
            modules[code] = bundled?.modules[code] ?? LabRotation.ModuleInfo(name: code)
        }
        return LabRotation(title: saved.title ?? bundled?.title ?? "Lab rotation",
                           modules: modules, sessions: saved.sessions)
    }
}

public enum LabRotationStoreFactory {
    public static func make() -> LabRotationStore? {
        SupabaseConfig.bundled().map { SupabaseLabRotationStore(config: $0) }
    }
}

extension Notification.Name {
    /// The rotation on this device changed; anything showing labs should rebuild.
    static let labRotationChanged = Notification.Name("ie.dcu.timetable.labRotationChanged")
}
