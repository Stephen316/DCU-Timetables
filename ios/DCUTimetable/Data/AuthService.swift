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

public enum AuthError: LocalizedError, Equatable {
    case notConfigured
    /// The address exists but hasn't been confirmed yet, so the "check your email" step
    /// should open instead of the sign-in failing.
    case emailNotConfirmed
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Sign-in isn't configured yet (missing supabase.local.json)."
        case .emailNotConfirmed:
            return "Confirm your DCU email address first."
        case .server(let message):
            return message
        }
    }
}

/// What happened when an account was created.
public enum SignUpOutcome: Sendable, Equatable {
    /// Supabase sent a confirmation email; the address must be confirmed before sign-in.
    case needsEmailConfirmation
    /// Confirmations are switched off in Supabase, so the account is usable immediately.
    case signedIn(AuthenticatedUser)
}

public protocol AuthService: Sendable {
    func signUp(email: DCUEmail, password: String) async throws -> SignUpOutcome
    func signIn(email: DCUEmail, password: String) async throws -> AuthenticatedUser
    /// Send the confirmation email again to an address that hasn't been confirmed yet.
    func resendConfirmation(to email: DCUEmail) async throws
    func sendPasswordReset(to email: DCUEmail) async throws
}

/// Supabase Auth email-and-password sign-in, with the address confirmed by the link
/// Supabase emails.
public struct SupabaseAuthService: AuthService {
    private let config: SupabaseConfig
    private let session: URLSession

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func signUp(email: DCUEmail, password: String) async throws -> SignUpOutcome {
        let data = try await post("/auth/v1/signup", body: [
            "email": email.address,
            "password": password,
        ])
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        // A session only comes back when email confirmation is disabled; otherwise Supabase
        // has emailed a confirmation link and the account isn't usable yet.
        if let session = AuthSessionParser.session(from: json) {
            await SupabaseSession.shared.save(session)
            return .signedIn(AuthenticatedUser(id: session.userID, address: email.address))
        }
        return .needsEmailConfirmation
    }

    public func signIn(email: DCUEmail, password: String) async throws -> AuthenticatedUser {
        let data: Data
        do {
            data = try await post("/auth/v1/token?grant_type=password", body: [
                "email": email.address,
                "password": password,
            ])
        } catch let error as AuthError {
            // Supabase reports an unconfirmed address as a plain sign-in failure; the view
            // needs to tell the two apart so it can open the confirmation step instead.
            if case .server(let message) = error, Self.isUnconfirmed(message) {
                throw AuthError.emailNotConfirmed
            }
            throw error
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let session = AuthSessionParser.session(from: json) else {
            throw AuthError.server("Couldn't sign in. Check your email and password.")
        }
        // The tokens go to the Keychain: every later write to Supabase is made as this
        // student, which is what lets the database check they own what they're changing.
        await SupabaseSession.shared.save(session)
        return AuthenticatedUser(id: session.userID, address: email.address)
    }

    public func resendConfirmation(to email: DCUEmail) async throws {
        _ = try await post("/auth/v1/resend", body: [
            "email": email.address,
            "type": "signup",
        ])
    }

    public func sendPasswordReset(to email: DCUEmail) async throws {
        _ = try await post("/auth/v1/recover", body: ["email": email.address])
    }

    private static func isUnconfirmed(_ message: String) -> Bool {
        let lowered = message.lowercased()
        return lowered.contains("not confirmed") || lowered.contains("email_not_confirmed")
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
        forgetLocally()
        Task { await SupabaseSession.shared.clear() }
    }

    /// Forget who was signed in without touching the Keychain. Used when the session has
    /// already been discarded because it couldn't be refreshed — going back through
    /// `signOut` from inside `SupabaseSession` would be a round trip into the actor that
    /// is already mid-clear.
    public static func forgetLocally() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

public extension Notification.Name {
    /// The refresh token is dead and the student has been signed out. Without this the app
    /// keeps showing them as signed in while every write is silently rejected, because
    /// `SignedInUser` lives in `UserDefaults` and the token lives in the Keychain.
    static let authSessionExpired = Notification.Name("ie.dcu.timetable.authSessionExpired")

    /// Something deep in the app wants the student signed out and the device wiped — the
    /// account screen after a deletion, for one. Only `RootView` owns that teardown (the
    /// profile, the attendance marks and the voter id all go with the credentials), and a
    /// sheet several layers down can't reach it.
    static let signOutRequested = Notification.Name("ie.dcu.timetable.signOutRequested")
}

public enum AuthServiceFactory {
    public static func make() -> AuthService? {
        SupabaseConfig.bundled().map { SupabaseAuthService(config: $0) }
    }
}
