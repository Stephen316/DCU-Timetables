import Foundation

/// Where deadlines are shared between everyone taking a module.
public protocol DeadlineStore: Sendable {
    func deadlines(forModule moduleKey: String) async throws -> [Deadline]
    /// Every module on screen at once — the timetable needs them all to draw its borders.
    func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline]
    func submit(_ deadline: Deadline) async throws
    /// Only the student who submitted it can remove one — enforced by the database's RLS
    /// policy, not just by hiding the button.
    func withdraw(id: String, submitterID: String) async throws
    /// Who has vouched for these deadlines being right.
    func confirmations(forDeadlineIDs ids: [String]) async throws -> [DeadlineConfirmation]
    func confirm(deadlineID: String, confirmerID: String) async throws
    func unconfirm(deadlineID: String, confirmerID: String) async throws
}

public struct SupabaseDeadlineStore: DeadlineStore {
    private let config: SupabaseConfig
    private let session: URLSession
    private let table = "module_deadlines"
    private let confirmationTable = "deadline_confirmations"

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    private struct Row: Codable {
        let id: String
        let module_key: String
        let at_group_key: String?
        let title: String
        let due_at: Date
        let kind: String
        let submitter_id: String
        let submitted_at: Date?
    }

    public func deadlines(forModule moduleKey: String) async throws -> [Deadline] {
        try await deadlines(matching: "eq.\(moduleKey)")
    }

    public func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline] {
        let unique = Set(moduleKeys).sorted()
        guard !unique.isEmpty else { return [] }
        let list = unique.map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"" }.joined(separator: ",")
        return try await deadlines(matching: "in.(\(list))")
    }

    private func deadlines(matching moduleFilter: String) async throws -> [Deadline] {
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "select",
                         value: "id,module_key,at_group_key,title,due_at,kind,submitter_id,submitted_at"),
            URLQueryItem(name: "module_key", value: moduleFilter),
            URLQueryItem(name: "order", value: "due_at.asc"),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let rows = (try? decoder.decode([Row].self, from: data)) ?? []
        return rows.map {
            Deadline(id: $0.id, moduleKey: $0.module_key, atGroupKey: $0.at_group_key,
                     title: $0.title, due: $0.due_at,
                     kind: DeadlineKind(rawValue: $0.kind) ?? .other,
                     submitterID: $0.submitter_id, submittedAt: $0.submitted_at ?? Date())
        }
    }

    public func submit(_ deadline: Deadline) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(table)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode([
            Row(id: deadline.id, module_key: deadline.moduleKey,
                at_group_key: deadline.atGroupKey, title: deadline.title,
                due_at: deadline.due, kind: deadline.kind.rawValue,
                submitter_id: deadline.submitterID, submitted_at: nil)
        ])
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    public func withdraw(id: String, submitterID: String) async throws {
        var components = URLComponents(string: "\(config.url)/rest/v1/\(table)")!
        components.queryItems = [
            URLQueryItem(name: "id", value: "eq.\(id)"),
            URLQueryItem(name: "submitter_id", value: "eq.\(submitterID)"),
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        await apply(&request)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    // MARK: Confirmations

    private struct ConfirmationRow: Codable {
        let deadline_id: String
        let confirmer_id: String
    }

    public func confirmations(forDeadlineIDs ids: [String]) async throws -> [DeadlineConfirmation] {
        guard !ids.isEmpty else { return [] }
        var components = URLComponents(string: "\(config.url)/rest/v1/\(confirmationTable)")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "deadline_id,confirmer_id"),
            URLQueryItem(name: "deadline_id", value: "in.(\(ids.joined(separator: ",")))"),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        let rows = (try? JSONDecoder().decode([ConfirmationRow].self, from: data)) ?? []
        return rows.map { DeadlineConfirmation(deadlineID: $0.deadline_id, confirmerID: $0.confirmer_id) }
    }

    public func confirm(deadlineID: String, confirmerID: String) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(confirmationTable)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // The composite primary key makes confirming twice a no-op, not a second vote.
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONEncoder().encode([
            ConfirmationRow(deadline_id: deadlineID, confirmer_id: confirmerID)
        ])
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    public func unconfirm(deadlineID: String, confirmerID: String) async throws {
        var components = URLComponents(string: "\(config.url)/rest/v1/\(confirmationTable)")!
        components.queryItems = [
            URLQueryItem(name: "deadline_id", value: "eq.\(deadlineID)"),
            URLQueryItem(name: "confirmer_id", value: "eq.\(confirmerID)"),
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        await apply(&request)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    /// Authorised as the signed-in student, so the database can check `auth.uid()` against
    /// the row being written. Without a session it falls back to the anon key, which RLS
    /// gives read-only access.
    private func apply(_ request: inout URLRequest) async {
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        let token = await SupabaseSession.shared.accessToken(config: config) ?? config.anonKey
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) else { return }
        throw NSError(domain: "Supabase", code: http.statusCode,
                      userInfo: [NSLocalizedDescriptionKey: "Deadline service returned \(http.statusCode)."])
    }
}

/// Used until Supabase is configured. Deadlines stay on this device — honest behaviour:
/// you see your own, and no one else's, because there is nowhere to share them.
public actor LocalDeadlineStore: DeadlineStore {
    private let fileURL: URL?
    private let confirmationURL: URL?

    public init(fileName: String = "module_deadlines.json") {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        fileURL = documents?.appendingPathComponent(fileName)
        confirmationURL = documents?.appendingPathComponent("deadline_confirmations.json")
    }

    private func load() -> [Deadline] {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([Deadline].self, from: data)) ?? []
    }

    private func save(_ deadlines: [Deadline]) {
        guard let fileURL, let data = try? JSONEncoder().encode(deadlines) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    public func deadlines(forModule moduleKey: String) async throws -> [Deadline] {
        load().filter { $0.moduleKey == moduleKey }.sorted { $0.due < $1.due }
    }

    public func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline] {
        let wanted = Set(moduleKeys)
        return load().filter { wanted.contains($0.moduleKey) }.sorted { $0.due < $1.due }
    }

    public func submit(_ deadline: Deadline) async throws {
        var all = load()
        all.append(deadline)
        save(all)
    }

    public func withdraw(id: String, submitterID: String) async throws {
        save(load().filter { !($0.id == id && $0.submitterID == submitterID) })
    }

    public func confirmations(forDeadlineIDs ids: [String]) async throws -> [DeadlineConfirmation] {
        let wanted = Set(ids)
        return loadConfirmations().filter { wanted.contains($0.deadlineID) }
    }

    public func confirm(deadlineID: String, confirmerID: String) async throws {
        let confirmation = DeadlineConfirmation(deadlineID: deadlineID, confirmerID: confirmerID)
        var all = loadConfirmations()
        guard !all.contains(confirmation) else { return }
        all.append(confirmation)
        saveConfirmations(all)
    }

    public func unconfirm(deadlineID: String, confirmerID: String) async throws {
        saveConfirmations(loadConfirmations().filter {
            !($0.deadlineID == deadlineID && $0.confirmerID == confirmerID)
        })
    }

    private func loadConfirmations() -> [DeadlineConfirmation] {
        guard let confirmationURL, let data = try? Data(contentsOf: confirmationURL) else { return [] }
        return (try? JSONDecoder().decode([DeadlineConfirmation].self, from: data)) ?? []
    }

    private func saveConfirmations(_ list: [DeadlineConfirmation]) {
        guard let confirmationURL, let data = try? JSONEncoder().encode(list) else { return }
        try? data.write(to: confirmationURL, options: .atomic)
    }
}

public enum DeadlineStoreFactory {
    public static func make() -> DeadlineStore {
        if let config = SupabaseConfig.bundled() {
            return SupabaseDeadlineStore(config: config)
        }
        return LocalDeadlineStore()
    }
}
