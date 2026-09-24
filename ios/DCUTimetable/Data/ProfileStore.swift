import Foundation

/// The signed-in account's own profile row, and the things it can do to itself.
public protocol ProfileStore: Sendable {
    /// The signed-in account's row, or nil when nobody is signed in.
    func myProfile() async throws -> AccountProfile?
    /// Records the student number. It can be set once — after that only an admin can
    /// change it (`set_student_id` in `supabase/phase13_roster_allocations.sql`) — so the
    /// student confirms it before this is called.
    func setStudentID(_ number: StudentNumber) async throws
    /// Deletes the account for good. Contributions survive with the link broken — see
    /// `anonymise_contributions()` in `supabase/phase0_identity.sql`.
    func deleteAccount() async throws
}

public enum ProfileStoreError: LocalizedError, Equatable {
    case notSignedIn
    case server(Int)
    /// The database said no and said why, in words meant for the student.
    case refused(String)

    public var errorDescription: String? {
        switch self {
        case .notSignedIn: return "You're not signed in."
        case .server(let code): return "The server returned \(code)."
        case .refused(let reason): return reason
        }
    }
}

public struct SupabaseProfileStore: ProfileStore {
    private let config: SupabaseConfig
    private let session: URLSession
    private let table = "profiles"

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    private struct Row: Decodable {
        let id: String
        let role: String
        let pi: String?
        let display_name: String?
        let banned_until: Date?
        let student_id: String?
    }

    public func myProfile() async throws -> AccountProfile? {
        guard let uid = await SupabaseSession.shared.userID else { throw ProfileStoreError.notSignedIn }

        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,role,pi,display_name,banned_until,student_id"),
            URLQueryItem(name: "id", value: "eq.\(uid)"),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)

        let (data, response) = try await session.data(for: request)
        try check(response)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // RLS returns an empty array rather than an error when a row isn't readable, so
        // "no row" and "not allowed" look the same here — both mean "no profile", which
        // is the safe reading either way.
        guard let row = (try? decoder.decode([Row].self, from: data))?.first else { return nil }
        return AccountProfile(id: row.id,
                              role: AppRole(rawValue: row.role) ?? .student,
                              pi: row.pi,
                              displayName: row.display_name,
                              bannedUntil: row.banned_until,
                              studentID: row.student_id)
    }

    public func setStudentID(_ number: StudentNumber) async throws {
        guard await SupabaseSession.shared.userID != nil else { throw ProfileStoreError.notSignedIn }

        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/rpc/set_student_id")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["p_student_id": number.value])

        let (data, response) = try await session.data(for: request)
        // The function refuses with an exception ("your student ID is already set — ask an
        // admin to change it"), which PostgREST returns as a 400 carrying that sentence.
        // A bare "The server returned 400." would leave the student nothing to act on.
        if let http = response as? HTTPURLResponse, http.statusCode == 400,
           let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let message = json["message"] as? String, !message.isEmpty {
            throw ProfileStoreError.refused(message.prefix(1).uppercased() + message.dropFirst())
        }
        try check(response)
    }

    public func deleteAccount() async throws {
        // An anon key can't delete from auth.users, so this goes through the
        // `security definer` RPC, which deletes only `auth.uid()`'s own row.
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/rpc/delete_own_account")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    private func apply(_ request: inout URLRequest) async {
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        let token = await SupabaseSession.shared.accessToken(config: config) ?? config.anonKey
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse,
              !(200...299).contains(http.statusCode) else { return }
        throw ProfileStoreError.server(http.statusCode)
    }
}

/// Used until Supabase is configured. Reports the account as a plain student, which is
/// the honest answer when there is no server to ask — better than inventing a role.
public struct LocalProfileStore: ProfileStore {
    public init() {}

    public func myProfile() async throws -> AccountProfile? {
        guard let user = SignedInUser.current else { return nil }
        return AccountProfile(id: user.id)
    }

    /// Nowhere to keep it. `RootView` still records locally that the step is done, so the
    /// student isn't asked again on every launch.
    public func setStudentID(_ number: StudentNumber) async throws {}

    public func deleteAccount() async throws {}
}

public enum ProfileStoreFactory {
    public static func make() -> ProfileStore {
        if let config = SupabaseConfig.bundled() {
            return SupabaseProfileStore(config: config)
        }
        return LocalProfileStore()
    }
}

/// The last role the server reported, so a menu can render without waiting on a request.
///
/// A cache, never a decision: it is re-read on every appearance, and the database enforces
/// what it merely hints at. Someone who edits this value gets extra buttons and a string of
/// 403s.
public enum CachedRole {
    private static let key = "accountRole"

    public static var current: AppRole {
        guard let raw = UserDefaults.standard.string(forKey: key) else { return .student }
        return AppRole(rawValue: raw) ?? .student
    }

    public static func save(_ role: AppRole) {
        UserDefaults.standard.set(role.rawValue, forKey: key)
    }

    /// Dropped on sign-out with everything else this student left behind — inheriting a
    /// previous person's role on a shared device would be wrong twice over.
    public static func reset() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
