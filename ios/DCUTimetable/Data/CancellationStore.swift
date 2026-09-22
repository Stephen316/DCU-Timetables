import Foundation

/// Where cancellation reports are shared between students.
public protocol CancellationStore: Sendable {
    /// Counts from the server, plus how this person voted. Replaces reading raw report
    /// rows: the device is no longer allowed to see who reported what, and no longer needs
    /// to (see `supabase/phase3_anonymity.sql`).
    func tallies(forKeys keys: [String]) async throws -> [CancellationTally]
    /// Insert only. Changing your mind is a `withdraw` then a `submit`, because the write
    /// path is `ON CONFLICT DO NOTHING` and there is deliberately no UPDATE policy on the
    /// table — see `submit(_:)` below.
    func submit(_ report: CancellationReport) async throws
    func withdraw(eventKey: String, reporterID: String) async throws
}

/// Anonymous, per-install id. Not a name or account — it exists only so one device can't
/// flag a class by reporting repeatedly.
public enum ReporterID {
    public static let storageKey = "cancellationReporterID"

    public static var current: String {
        // A signed-in student is the same person across reinstalls, which is a much better
        // basis for one-vote-per-person than a per-install UUID.
        if let user = SignedInUser.current { return user.id }
        if let existing = UserDefaults.standard.string(forKey: storageKey) { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: storageKey)
        return fresh
    }

    /// Dropped on sign-out: the next person to use this device is a different voter.
    public static func reset() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}

/// Small shared pieces of PostgREST's query syntax, in one place so every caller quotes
/// the same way — an unquoted value containing a comma silently becomes two filters.
public enum PostgREST {
    /// `in.("a","b")`, with embedded quotes stripped rather than escaped: none of the keys
    /// this app filters on can legitimately contain one.
    public static func inList(_ values: [String]) -> String {
        let quoted = values
            .map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"" }
            .joined(separator: ",")
        return "in.(\(quoted))"
    }
}

// MARK: - Supabase

public struct SupabaseConfig: Codable, Sendable {
    public let url: String
    public let anonKey: String

    /// Loaded from `supabase.local.json` in the bundle — git-ignored, so the key never
    /// reaches the repo. Absent config means the app falls back to the local store.
    public static func bundled(in bundle: Bundle = .main) -> SupabaseConfig? {
        guard let url = bundle.url(forResource: "supabase.local", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SupabaseConfig.self, from: data)
    }
}

public struct SupabaseCancellationStore: CancellationStore {
    private let config: SupabaseConfig
    private let session: URLSession
    private let table = "cancellation_reports"

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    private struct TallyRow: Decodable {
        let event_key: String
        let report_count: Int
        /// Absent on a server that hasn't run the stance migration yet.
        let on_count: Int?
        /// Null when this caller hasn't voted on the class.
        let my_stance: String?
    }

    /// One request. The view counts every row (it runs with its owner's rights, so RLS
    /// does not hide the other reporters from it) and answers `my_stance` from
    /// `auth.uid()`, which still resolves to this caller. No reporter id is returned
    /// either way.
    public func tallies(forKeys keys: [String]) async throws -> [CancellationTally] {
        guard !keys.isEmpty else { return [] }
        var components = URLComponents(string: "\(config.url)/rest/v1/cancellation_tallies")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "event_key,report_count,on_count,my_stance"),
            URLQueryItem(name: "event_key", value: PostgREST.inList(keys)),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        let rows = (try? JSONDecoder().decode([TallyRow].self, from: data)) ?? []
        return rows.map {
            CancellationTally(eventKey: $0.event_key,
                              reportCount: $0.report_count,
                              onCount: $0.on_count ?? 0,
                              myStance: $0.my_stance.flatMap(ReportStance.init(rawValue:)))
        }
    }

    public func submit(_ report: CancellationReport) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(table)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // A repeat report is genuinely a no-op, so this is `ON CONFLICT DO NOTHING`.
        // `merge-duplicates` would be `DO UPDATE`, which RLS refuses without an UPDATE
        // policy — and granting one would let a row's owner be rewritten for no gain.
        //
        // The consequence is that posting `on` over your own existing `cancelled` row does
        // nothing at all. Switching sides therefore has to delete first; the view model
        // does exactly that, and this is why.
        request.setValue("resolution=ignore-duplicates", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONEncoder().encode([
            [
                "event_key": report.eventKey,
                "reporter_id": report.reporterID,
                "stance": report.stance.rawValue,
            ]
        ])
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    public func withdraw(eventKey: String, reporterID: String) async throws {
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "event_key", value: "eq.\(eventKey)"),
            URLQueryItem(name: "reporter_id", value: "eq.\(reporterID)"),
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        await apply(&request)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    /// Authorised as the signed-in student when there's a session, so the database can
    /// check `auth.uid()` against the row's reporter. Falls back to the anon key, which RLS
    /// then treats as an anonymous client with read-only access.
    private func apply(_ request: inout URLRequest) async {
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        let token = await SupabaseSession.shared.accessToken(config: config) ?? config.anonKey
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) else { return }
        throw NSError(domain: "Supabase", code: http.statusCode,
                      userInfo: [NSLocalizedDescriptionKey: "Report service returned \(http.statusCode)."])
    }
}

// MARK: - Local fallback

/// Used until Supabase is configured. Reports stay on this device, so the threshold will
/// not be reached by one person — which is the honest behaviour, not a simulated crowd.
public actor LocalCancellationStore: CancellationStore {
    private let fileURL: URL?

    public init(fileName: String = "cancellation_reports.json") {
        fileURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .first?.appendingPathComponent(fileName)
    }

    private func load() -> [CancellationReport] {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([CancellationReport].self, from: data)) ?? []
    }

    private func save(_ reports: [CancellationReport]) {
        guard let fileURL, let data = try? JSONEncoder().encode(reports) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Every row here was written by the one person using this device, so the stance on
    /// file *is* their stance — there is no crowd to separate them from.
    public func tallies(forKeys keys: [String]) async throws -> [CancellationTally] {
        let wanted = Set(keys)
        let mine = load().filter { wanted.contains($0.eventKey) }
        return Dictionary(grouping: mine, by: \.eventKey).map { key, rows in
            CancellationTally(eventKey: key,
                              reportCount: rows.filter { $0.stance == .cancelled }.count,
                              onCount: rows.filter { $0.stance == .on }.count,
                              myStance: rows.last?.stance)
        }
    }

    /// Matches the server: one row per person per class, and a repeat is a no-op.
    public func submit(_ report: CancellationReport) async throws {
        var all = load()
        guard !all.contains(where: { $0.eventKey == report.eventKey && $0.reporterID == report.reporterID })
        else { return }
        all.append(report)
        save(all)
    }

    public func withdraw(eventKey: String, reporterID: String) async throws {
        save(load().filter { !($0.eventKey == eventKey && $0.reporterID == reporterID) })
    }
}

public enum CancellationStoreFactory {
    /// Supabase when configured, otherwise on-device.
    public static func make() -> CancellationStore {
        if let config = SupabaseConfig.bundled() {
            return SupabaseCancellationStore(config: config)
        }
        return LocalCancellationStore()
    }
}
