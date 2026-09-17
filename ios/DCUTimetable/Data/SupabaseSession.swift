import Foundation

/// The signed-in student's Supabase tokens.
public struct AuthSession: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let userID: String

    public init(accessToken: String, refreshToken: String, expiresAt: Date, userID: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userID = userID
    }

    /// Treated as expired a minute early, so a request never sets off with a token that
    /// dies in flight.
    public func isValid(at now: Date = Date()) -> Bool {
        expiresAt.timeIntervalSince(now) > 60
    }
}

/// Holds the session and hands out a usable access token, refreshing it when it has aged
/// out. An actor because every store asks it concurrently and a refresh must happen once.
public actor SupabaseSession {
    public static let shared = SupabaseSession()

    private static let keychainKey = "session"

    private var cached: AuthSession?
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
        self.cached = Self.stored()
    }

    private static func stored() -> AuthSession? {
        guard let data = Keychain.read(key: keychainKey) else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    public func save(_ session: AuthSession) {
        cached = session
        if let data = try? JSONEncoder().encode(session) {
            Keychain.save(data, key: Self.keychainKey)
        }
    }

    public func clear() {
        cached = nil
        Keychain.delete(key: Self.keychainKey)
    }

    public var userID: String? { cached?.userID }

    /// A live access token, or nil when nobody is signed in and nothing can be refreshed.
    /// Callers fall back to the anon key, which RLS then treats as an anonymous client.
    public func accessToken(config: SupabaseConfig) async -> String? {
        guard let current = cached else { return nil }
        if current.isValid() { return current.accessToken }
        guard let refreshed = await refresh(current, config: config) else {
            // The refresh token is dead. Clearing the Keychain isn't enough on its own:
            // `SignedInUser` would still say they're signed in, so every write would be
            // made anonymously and rejected by RLS while the UI showed nothing wrong.
            clear()
            SignedInUser.forgetLocally()
            NotificationCenter.default.post(name: .authSessionExpired, object: nil)
            return nil
        }
        save(refreshed)
        return refreshed.accessToken
    }

    private func refresh(_ current: AuthSession, config: SupabaseConfig) async -> AuthSession? {
        var request = URLRequest(url: URL(string: "\(config.url)/auth/v1/token?grant_type=refresh_token")!)
        request.httpMethod = "POST"
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": current.refreshToken])

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        return AuthSessionParser.session(from: json)
    }
}

/// Reads Supabase's token response, which is the same shape from sign-in, sign-up and
/// refresh.
public enum AuthSessionParser {
    public static func session(from json: [String: Any], now: Date = Date()) -> AuthSession? {
        guard let access = json["access_token"] as? String,
              let refresh = json["refresh_token"] as? String,
              let user = json["user"] as? [String: Any],
              let id = user["id"] as? String else { return nil }
        // `expires_in` is seconds; `expires_at` is a unix timestamp. Either may be present.
        let expiry: Date
        if let at = json["expires_at"] as? Double {
            expiry = Date(timeIntervalSince1970: at)
        } else {
            expiry = now.addingTimeInterval((json["expires_in"] as? Double) ?? 3600)
        }
        return AuthSession(accessToken: access, refreshToken: refresh, expiresAt: expiry, userID: id)
    }
}
