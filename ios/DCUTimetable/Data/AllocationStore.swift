import Foundation

/// A student's lab allocation: which group, and the rooms that follow from it. What a phone
/// downloads from `course_allocations` — no names, no IDs.
public struct Allocation: Codable, Equatable, Sendable {
    public let group: String
    public let subgroup: String?
    public let day: String?
    public let workshop: String?
    public let drawing: String?

    public init(group: String, subgroup: String? = nil, day: String? = nil,
                workshop: String? = nil, drawing: String? = nil) {
        self.group = group
        self.subgroup = subgroup
        self.day = day
        self.workshop = workshop
        self.drawing = drawing
    }

    enum CodingKeys: String, CodingKey {
        case group = "grp", subgroup, day, workshop, drawing
    }
}

/// A class list an admin has uploaded. Title and version only; the list itself stays on the
/// server.
public struct RosterSummary: Decodable, Equatable, Sendable, Identifiable {
    public let courseKey: String
    public let title: String?
    public let version: Int

    public var id: String { courseKey }

    public init(courseKey: String, title: String?, version: Int) {
        self.courseKey = courseKey
        self.title = title
        self.version = version
    }

    enum CodingKeys: String, CodingKey {
        case courseKey = "course_key", title, version
    }
}

/// What `resolve_allocation` said about the signed-in student.
public enum AllocationResolution: Equatable, Sendable {
    /// Exactly one row. `key` is hex, as the RPC returns it.
    case matched(key: String, version: Int)
    /// Several students share this name; ask which subgroup and call again.
    case ambiguous
    /// Not on this class list.
    case notListed
    /// The name and the student ID point different ways. The server has flagged it for an
    /// admin; nothing here can settle it.
    case conflict
    /// Nothing has been uploaded for this course.
    case noRoster

    /// Decodes the RPC's one-row table. An unknown status reads as "not listed" — the one
    /// answer that never shows a student somebody else's labs.
    public static func decode(_ data: Data) throws -> AllocationResolution {
        struct Row: Decodable {
            let status: String
            let allocation_key: String?
            let version: Int?
        }
        guard let row = try JSONDecoder().decode([Row].self, from: data).first else { return .notListed }
        switch row.status {
        case "matched":
            guard let key = row.allocation_key, let version = row.version else { return .notListed }
            return .matched(key: key, version: version)
        case "ambiguous": return .ambiguous
        case "conflict": return .conflict
        case "no_roster": return .noRoster
        default: return .notListed
        }
    }
}

public protocol AllocationStore: Sendable {
    /// Every class list that has been uploaded.
    func rosters() async throws -> [RosterSummary]
    /// Matches the signed-in account on the server. The name comes from the verified
    /// address there, not from anything sent from here.
    func resolve(courseKey: String, subgroup: String?) async throws -> AllocationResolution
    /// The one allocation row for a resolved key.
    func allocation(courseKey: String, key: String) async throws -> Allocation?
    /// The subgroups on a course's list, to ask a student with a shared name which is theirs.
    func subgroups(courseKey: String) async throws -> [String]
}

public enum AllocationStoreError: LocalizedError, Equatable {
    case server(Int)

    public var errorDescription: String? {
        switch self {
        case .server(let code): return "The server returned \(code)."
        }
    }
}

public struct SupabaseAllocationStore: AllocationStore {
    private let config: SupabaseConfig
    private let session: URLSession

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func rosters() async throws -> [RosterSummary] {
        var components = URLComponents(string: "\(config.url)/rest/v1/rosters")!
        components.queryItems = [URLQueryItem(name: "select", value: "course_key,title,version")]
        let data = try await get(components)
        return try JSONDecoder().decode([RosterSummary].self, from: data)
    }

    public func resolve(courseKey: String, subgroup: String?) async throws -> AllocationResolution {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/rpc/resolve_allocation")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: String] = ["p_course_key": courseKey]
        if let subgroup { body["p_subgroup"] = subgroup }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        try check(response)
        return try AllocationResolution.decode(data)
    }

    public func allocation(courseKey: String, key: String) async throws -> Allocation? {
        var components = URLComponents(string: "\(config.url)/rest/v1/course_allocations")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "grp,subgroup,day,workshop,drawing"),
            URLQueryItem(name: "course_key", value: "eq.\(courseKey)"),
            // PostgREST reads a bytea literal as \x followed by hex.
            URLQueryItem(name: "allocation_key", value: "eq.\\x\(key)"),
        ]
        let data = try await get(components)
        return try JSONDecoder().decode([Allocation].self, from: data).first
    }

    public func subgroups(courseKey: String) async throws -> [String] {
        struct Row: Decodable { let subgroup: String? }
        var components = URLComponents(string: "\(config.url)/rest/v1/course_allocations")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "subgroup"),
            URLQueryItem(name: "course_key", value: "eq.\(courseKey)"),
        ]
        let rows = try JSONDecoder().decode([Row].self, from: try await get(components))
        return Set(rows.compactMap(\.subgroup)).sorted()
    }

    private func get(_ components: URLComponents) async throws -> Data {
        var request = URLRequest(url: components.url!)
        await apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        return data
    }

    private func apply(_ request: inout URLRequest) async {
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        let token = await SupabaseSession.shared.accessToken(config: config) ?? config.anonKey
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse,
              !(200...299).contains(http.statusCode) else { return }
        throw AllocationStoreError.server(http.statusCode)
    }
}

public enum AllocationStoreFactory {
    /// Nil until Supabase is configured. There is no local stand-in: a class list lives on
    /// the server or nowhere, and a local copy is exactly what this replaced.
    public static func make() -> AllocationStore? {
        SupabaseConfig.bundled().map { SupabaseAllocationStore(config: $0) }
    }
}

/// Keeps a saved profile in step with the class list it came from.
///
/// An admin re-uploading a corrected list bumps its version. When the version on the server
/// differs from the one the profile was made from, the profile is resolved again rather than
/// trusted — the diagram's "re-import triggers re-resolve".
public enum AllocationRefresh {
    public enum Outcome: Equatable, Sendable {
        /// Nothing to do, or the server could not be asked — a network failure keeps the
        /// profile that works rather than dropping it.
        case unchanged
        case updated(StudentProfile)
        /// The student is no longer on the list, or can no longer be told apart. Back to
        /// the profile screen.
        case dropped
    }

    public static func check(_ profile: StudentProfile, store: AllocationStore) async -> Outcome {
        guard let courseKey = profile.courseKey, let version = profile.rosterVersion else { return .unchanged }
        do {
            let current = try await store.rosters().first { $0.courseKey == courseKey }
            guard let current else { return .dropped }
            if current.version == version { return .unchanged }

            switch try await store.resolve(courseKey: courseKey, subgroup: profile.subgroup.isEmpty ? nil : profile.subgroup) {
            case .matched(let key, let newVersion):
                guard let allocation = try await store.allocation(courseKey: courseKey, key: key) else { return .unchanged }
                return .updated(StudentProfile(name: profile.name, cohort: profile.cohort, allocation: allocation,
                                               allocationKey: key, rosterVersion: newVersion))
            case .ambiguous, .notListed, .conflict, .noRoster:
                return .dropped
            }
        } catch {
            return .unchanged
        }
    }

    public enum Adoption: Equatable, Sendable {
        /// On a list now: the timetable switches from the programme they picked to their labs.
        case adopted(StudentProfile)
        /// Stay on the picked programme. `tried` is each list's version as asked about, so
        /// the same list isn't asked about again.
        case stay(tried: [String: Int])
    }

    /// For a student who picked a programme because no list had them — often because none
    /// was uploaded yet. Each list is asked about once per version: a conflict files a flag
    /// for an admin on every call, and a student who isn't on a list stays not on it until
    /// it changes.
    ///
    /// A shared name comes back ambiguous and stays: settling it needs the subgroup
    /// question, which belongs on the profile screen rather than appearing unasked.
    public static func adopt(name: String, tried: [String: Int], store: AllocationStore) async -> Adoption {
        var tried = tried
        do {
            let fresh = try await store.rosters().filter {
                StudentProfile.Cohort(courseKey: $0.courseKey) != nil && tried[$0.courseKey] != $0.version
            }
            for roster in fresh.sorted(by: { $0.courseKey < $1.courseKey }) {
                guard let cohort = StudentProfile.Cohort(courseKey: roster.courseKey) else { continue }
                if case .matched(let key, let version) = try await store.resolve(courseKey: roster.courseKey, subgroup: nil),
                   let allocation = try await store.allocation(courseKey: roster.courseKey, key: key) {
                    return .adopted(StudentProfile(name: name, cohort: cohort, allocation: allocation,
                                                   allocationKey: key, rosterVersion: version))
                }
                tried[roster.courseKey] = roster.version
            }
        } catch {
            // Offline: whatever was asked about before the failure stays asked; the rest is
            // tried next time.
        }
        return .stay(tried: tried)
    }
}
