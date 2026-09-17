import Foundation

/// Where cancellation reports are shared between students.
public protocol CancellationStore: Sendable {
    func reports(forKeys keys: [String]) async throws -> [CancellationReport]
    func submit(_ report: CancellationReport) async throws
    func withdraw(eventKey: String, reporterID: String) async throws
}

/// Anonymous, per-install id. Not a name or account — it exists only so one device can't
/// flag a class by reporting repeatedly.
public enum ReporterID {
    private static let key = "cancellationReporterID"

    public static var current: String {
        // A signed-in student is the same person across reinstalls, which is a much better
        // basis for one-vote-per-person than a per-install UUID.
        if let user = SignedInUser.current { return user.id }
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
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

    private struct Row: Codable {
        let event_key: String
        let reporter_id: String
        let reported_at: Date?
    }

    public func reports(forKeys keys: [String]) async throws -> [CancellationReport] {
        guard !keys.isEmpty else { return [] }
        // PostgREST `in.(…)` needs each value quoted, since keys contain commas and slashes.
        let list = keys.map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"" }.joined(separator: ",")
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "event_key,reporter_id,reported_at"),
            URLQueryItem(name: "event_key", value: "in.(\(list))"),
        ]
        var request = URLRequest(url: components.url!)
        apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let rows = (try? decoder.decode([Row].self, from: data)) ?? []
        return rows.map {
            CancellationReport(eventKey: $0.event_key, reporterID: $0.reporter_id,
                               reportedAt: $0.reported_at ?? Date())
        }
    }

    public func submit(_ report: CancellationReport) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(table)")!)
        request.httpMethod = "POST"
        apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Upsert: the table's (event_key, reporter_id) primary key makes a repeat report a
        // no-op rather than a second vote.
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONEncoder().encode([
            ["event_key": report.eventKey, "reporter_id": report.reporterID]
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
        apply(&request)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    private func apply(_ request: inout URLRequest) {
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
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

    public func reports(forKeys keys: [String]) async throws -> [CancellationReport] {
        let wanted = Set(keys)
        return load().filter { wanted.contains($0.eventKey) }
    }

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
