import Foundation

/// A student who has proved they control a DCU address.
public struct AuthenticatedUser: Codable, Sendable, Equatable {
    /// Supabase user id — stable across reinstalls, so it's a far better basis for
    /// one-vote-per-person than a per-install UUID.
    public let id: String
    public let address: String

    public var email: DCUEmail? { DCUEmail(address) }

    public init(id: String, address: String) {
        self.id = id
        self.address = address
    }
}

public enum AuthError: LocalizedError {
    case notConfigured
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Sign-in isn't configured yet (missing supabase.local.json)."
        case .server(let message):
            return message
        }
    }
}

public protocol AuthService: Sendable {
    func sendCode(to email: DCUEmail) async throws
    func verify(email: DCUEmail, code: String) async throws -> AuthenticatedUser
}

/// Supabase Auth one-time-code sign-in.
public struct SupabaseAuthService: AuthService {
    private let config: SupabaseConfig
    private let session: URLSession

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func sendCode(to email: DCUEmail) async throws {
        _ = try await post("/auth/v1/otp", body: [
            "email": email.address,
            "create_user": true,
        ])
    }

    public func verify(email: DCUEmail, code: String) async throws -> AuthenticatedUser {
        let data = try await post("/auth/v1/verify", body: [
            "email": email.address,
            "token": code.trimmingCharacters(in: .whitespaces),
            "type": "email",
        ])
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = json["user"] as? [String: Any],
              let id = user["id"] as? String
        else { throw AuthError.server("That code didn't work. Check it and try again.") }
        return AuthenticatedUser(id: id, address: email.address)
    }

    private func post(_ path: String, body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: URL(string: config.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!)
        request.httpMethod = "POST"
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw AuthError.server(Self.message(from: data, status: http.statusCode))
        }
        return data
    }

    /// Supabase puts the useful text in `msg`/`error_description`; falling back to a bare
    /// status code would leave the student with nothing actionable.
    private static func message(from data: Data, status: Int) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["msg", "error_description", "message", "error"] {
                if let text = json[key] as? String, !text.isEmpty { return text }
            }
        }
        if status == 429 { return "Too many attempts — wait a minute and try again." }
        return "Sign-in failed (\(status))."
    }
}

/// Remembers who is signed in. Holds no password or token — only the verified address and
/// user id, neither of which is a secret.
public enum SignedInUser {
    private static let key = "signedInUser"

    public static var current: AuthenticatedUser? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(AuthenticatedUser.self, from: data)
    }

    public static func save(_ user: AuthenticatedUser) {
        guard let data = try? JSONEncoder().encode(user) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    public static func signOut() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

public enum AuthServiceFactory {
    public static func make() -> AuthService? {
        SupabaseConfig.bundled().map { SupabaseAuthService(config: $0) }
    }
}
