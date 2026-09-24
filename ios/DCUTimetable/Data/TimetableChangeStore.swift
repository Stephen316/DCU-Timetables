import Foundation

/// The timetable changes saved in the console for a course (`timetable_changes`, phase 17).
public protocol TimetableChangeStore: Sendable {
    func changes(courseKey: String) async throws -> [TimetableChange]
}

public struct SupabaseTimetableChangeStore: TimetableChangeStore {
    private let config: SupabaseConfig
    private let session: URLSession

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func changes(courseKey: String) async throws -> [TimetableChange] {
        // Signed in or not at all, as for the rotation: the anon key reads an empty table,
        // and an empty answer would wipe the cached changes.
        guard let token = await SupabaseSession.shared.accessToken(config: config) else {
            throw AllocationStoreError.server(401)
        }
        var components = URLComponents(string: "\(config.url)/rest/v1/timetable_changes")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,course_key,grp,kind,module,activity_code,title,dates,start_time,end_time,room"),
            URLQueryItem(name: "course_key", value: "eq.\(courseKey)"),
            URLQueryItem(name: "order", value: "created_at"),
        ]
        var request = URLRequest(url: components.url!)
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw AllocationStoreError.server(http.statusCode)
        }
        return try JSONDecoder().decode([TimetableChange].self, from: data)
    }
}

/// The last changes downloaded per course, so they hold with no signal.
public struct TimetableChangeCache: Sendable {
    private let directory: URL

    public init(directory: URL? = nil) {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.directory = directory ?? base.appendingPathComponent("TimetableChanges", isDirectory: true)
        try? fileManager.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    public func changes(courseKey: String) -> [TimetableChange] {
        guard let data = try? Data(contentsOf: url(courseKey)) else { return [] }
        return (try? JSONDecoder().decode([TimetableChange].self, from: data)) ?? []
    }

    public func store(_ changes: [TimetableChange], courseKey: String) {
        guard let data = try? JSONEncoder().encode(changes) else { return }
        try? data.write(to: url(courseKey), options: .atomic)
    }

    private func url(_ courseKey: String) -> URL {
        directory.appendingPathComponent("\(courseKey.replacingOccurrences(of: "/", with: "_")).json")
    }
}

public enum TimetableChangeRefresh {
    /// True when the course's changes differ from what is cached. A failed request keeps
    /// the cache: offline must not bring back a class that was removed.
    ///
    /// The whole list each time rather than a version check — a course has a handful of
    /// changes, and a version would be one more thing the console could forget to bump.
    public static func run(courseKey: String, store: TimetableChangeStore, cache: TimetableChangeCache) async -> Bool {
        guard let fresh = try? await store.changes(courseKey: courseKey) else { return false }
        guard fresh != cache.changes(courseKey: courseKey) else { return false }
        cache.store(fresh, courseKey: courseKey)
        return true
    }
}

public enum TimetableChangeStoreFactory {
    public static func make() -> TimetableChangeStore? {
        SupabaseConfig.bundled().map { SupabaseTimetableChangeStore(config: $0) }
    }
}

extension Notification.Name {
    /// The saved changes on this device changed; the week view re-applies them.
    static let timetableChangesChanged = Notification.Name("ie.dcu.timetable.timetableChangesChanged")
}
