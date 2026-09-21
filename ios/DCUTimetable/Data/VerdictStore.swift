import Foundation

/// Where definitive verdicts on a class are shared. Reading is open to everyone; writing
/// is refused by the database for anyone who isn't trusted, so this protocol deliberately
/// offers `set` to all callers and lets RLS be the gate.
public protocol VerdictStore: Sendable {
    func verdicts(forKeys keys: [String]) async throws -> [EventVerdict]
    /// Posts or replaces the verdict on one class. `moduleKey` comes from
    /// `DeadlineRules.moduleKey(for:)` — it is passed in rather than parsed back out of
    /// the event key, because two implementations of the same derivation is exactly the
    /// bug that docs/ADMIN_CONSOLE.md §6 is about.
    func set(_ verdict: EventVerdict, moduleKey: String, decidedBy userID: String) async throws
    /// Withdraws one. Admin-only in the database — a trusted person corrects a mistake by
    /// posting `.running` over it, which leaves the history intact.
    func clear(eventKey: String) async throws
}

public struct SupabaseVerdictStore: VerdictStore {
    private let config: SupabaseConfig
    private let session: URLSession
    private let table = "event_verdicts"

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    private struct Row: Codable {
        let event_key: String
        let state: String
        let note: String?
        let room_override: String?
        let start_override: Date?
        let decided_by_label: String?
        let decided_at: Date?
    }

    public func verdicts(forKeys keys: [String]) async throws -> [EventVerdict] {
        guard !keys.isEmpty else { return [] }
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "select",
                         value: "event_key,state,note,room_override,start_override,decided_by_label,decided_at"),
            URLQueryItem(name: "event_key", value: PostgREST.inList(keys)),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)

        let (data, response) = try await session.data(for: request)
        try check(response)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let rows = (try? decoder.decode([Row].self, from: data)) ?? []
        // An unknown state is dropped rather than guessed at. A future 'rescheduled' that
        // this build renders as "cancelled" would be worse than showing nothing.
        return rows.compactMap { row in
            guard let state = VerdictState(rawValue: row.state) else { return nil }
            return EventVerdict(eventKey: row.event_key,
                                state: state,
                                note: row.note,
                                roomOverride: row.room_override,
                                startOverride: row.start_override,
                                decidedByLabel: row.decided_by_label,
                                decidedAt: row.decided_at ?? Date())
        }
    }

    public func set(_ verdict: EventVerdict, moduleKey: String,
                    decidedBy userID: String) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(table)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Changing your mind about a class must replace the row, not fail on its primary
        // key — so this is ON CONFLICT DO UPDATE, which needs the "amend" policy as well
        // as "write".
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")

        var row: [String: Any] = [
            "event_key": verdict.eventKey,
            "state": verdict.state.rawValue,
            "decided_by": userID,
        ]
        row["note"] = verdict.note
        row["room_override"] = verdict.roomOverride
        row["decided_by_label"] = verdict.decidedByLabel
        if let start = verdict.startOverride {
            row["start_override"] = ISO8601DateFormatter().string(from: start)
        }
        row["module_key"] = moduleKey

        request.httpBody = try JSONSerialization.data(
            withJSONObject: [row.compactMapValues { $0 is NSNull ? nil : $0 }])

        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    public func clear(eventKey: String) async throws {
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [URLQueryItem(name: "event_key", value: "eq.\(eventKey)")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        await apply(&request)

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
        // 401/403 is the ordinary answer for a student tapping a button they shouldn't
        // have been shown. Worth a readable message rather than a bare code.
        if http.statusCode == 401 || http.statusCode == 403 {
            throw NSError(domain: "Supabase", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "You don't have permission to decide this."
            ])
        }
        throw NSError(domain: "Supabase", code: http.statusCode, userInfo: [
            NSLocalizedDescriptionKey: "The verdict service returned \(http.statusCode)."
        ])
    }
}

/// Used until Supabase is configured. Verdicts stay on this device, which is honest: there
/// is no authority to consult, so there is no verdict to report.
public actor LocalVerdictStore: VerdictStore {
    private var stored: [String: EventVerdict] = [:]

    public init() {}

    public func verdicts(forKeys keys: [String]) async throws -> [EventVerdict] {
        keys.compactMap { stored[$0] }
    }

    public func set(_ verdict: EventVerdict, moduleKey: String,
                    decidedBy userID: String) async throws {
        stored[verdict.eventKey] = verdict
    }

    public func clear(eventKey: String) async throws {
        stored[eventKey] = nil
    }
}

public enum VerdictStoreFactory {
    public static func make() -> VerdictStore {
        if let config = SupabaseConfig.bundled() {
            return SupabaseVerdictStore(config: config)
        }
        return LocalVerdictStore()
    }
}
