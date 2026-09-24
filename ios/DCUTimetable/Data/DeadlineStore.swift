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
    /// How many vouched for each deadline, and which of them this person vouched for —
    /// without the device seeing who the others are.
    func standings(forDeadlineIDs ids: [String]) async throws -> [String: DeadlineStanding]
    func confirm(deadlineID: String, confirmerID: String) async throws
    func unconfirm(deadlineID: String, confirmerID: String) async throws

    // Moderation (App Review 1.2). Each names a deadline, never a person: deadlines are
    // anonymous to students, and the server looks up who posted one.

    /// Sends the deadline to the console's review queue and hides it from this student.
    func report(deadlineID: String, reason: DeadlineReportReason) async throws
    /// Stops everything the deadline's author posts reaching this student.
    func hideAuthor(ofDeadlineID deadlineID: String) async throws
    /// How many people this student has hidden. A count, not a list: a list would say who
    /// wrote what.
    func hiddenAuthorCount() async throws -> Int
    func unhideAllAuthors() async throws
}

/// With nowhere to share deadlines, there is no one else's content to moderate.
public extension DeadlineStore {
    func report(deadlineID: String, reason: DeadlineReportReason) async throws {}
    func hideAuthor(ofDeadlineID deadlineID: String) async throws {}
    func hiddenAuthorCount() async throws -> Int { 0 }
    func unhideAllAuthors() async throws {}
}

public struct SupabaseDeadlineStore: DeadlineStore {
    private let config: SupabaseConfig
    private let session: URLSession
    private let table = "module_deadlines"
    /// Reads go to the view, which swaps `submitter_id` for `is_mine`; writes go to the
    /// table, which is where the row actually lives.
    private let readTable = "module_deadlines_public"
    private let confirmationTable = "deadline_confirmations"

    public init(config: SupabaseConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    /// Reads and writes have genuinely different shapes now: the view hands back
    /// `is_mine` and no submitter, while an insert must carry the submitter and cannot
    /// set `is_mine` (it is computed). One struct doing both would have to make every
    /// field optional and lose the compiler's help.
    private struct InsertRow: Encodable {
        let id: String
        let module_key: String
        let at_group_key: String?
        let title: String
        let due_at: Date
        let kind: String
        let submitter_id: String
    }

    private struct Row: Decodable {
        let id: String
        let module_key: String
        let at_group_key: String?
        let title: String
        let due_at: Date
        let kind: String
        let is_mine: Bool?
        let submitted_at: Date?
    }

    public func deadlines(forModule moduleKey: String) async throws -> [Deadline] {
        try await deadlines(matching: "eq.\(moduleKey)")
    }

    public func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline] {
        let unique = Set(moduleKeys).sorted()
        guard !unique.isEmpty else { return [] }
        return try await deadlines(matching: PostgREST.inList(unique))
    }

    private func deadlines(matching moduleFilter: String) async throws -> [Deadline] {
        // Nothing prunes the table, so without a floor this download grows for the life of
        // the module. `DeadlineRules.horizon` is the same cut-off the client filters on.
        let since = ISO8601DateFormatter().string(from: DeadlineRules.horizon())
        var components = URLComponents(string: "\(config.url)/rest/v1/\(readTable)")!
        components.queryItems = [
            URLQueryItem(name: "select",
                         value: "id,module_key,at_group_key,title,due_at,kind,is_mine,submitted_at"),
            URLQueryItem(name: "module_key", value: moduleFilter),
            URLQueryItem(name: "due_at", value: "gte.\(since)"),
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
            // No submitter id comes back any more — `is_mine` is all the app used it for.
            Deadline(id: $0.id, moduleKey: $0.module_key, atGroupKey: $0.at_group_key,
                     title: $0.title, due: $0.due_at,
                     kind: DeadlineKind(rawValue: $0.kind) ?? .other,
                     submitterID: "", submittedAt: $0.submitted_at ?? Date(),
                     isMine: $0.is_mine ?? false)
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
            InsertRow(id: deadline.id, module_key: deadline.moduleKey,
                      at_group_key: deadline.atGroupKey, title: deadline.title,
                      due_at: deadline.due, kind: deadline.kind.rawValue,
                      submitter_id: deadline.submitterID)
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

    private struct StandingRow: Decodable {
        let deadline_id: String
        let confirm_count: Int
        let mine: Bool?
    }

    /// One request, same shape as `SupabaseCancellationStore.tallies`: the view counts
    /// every confirmer and answers `mine` from `auth.uid()`, returning nobody's id.
    public func standings(forDeadlineIDs ids: [String]) async throws -> [String: DeadlineStanding] {
        guard !ids.isEmpty else { return [:] }
        var components = URLComponents(string: "\(config.url)/rest/v1/deadline_confirmation_tallies")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "deadline_id,confirm_count,mine"),
            URLQueryItem(name: "deadline_id", value: PostgREST.inList(ids)),
        ]
        var request = URLRequest(url: components.url!)
        await apply(&request)
        let (data, response) = try await session.data(for: request)
        try check(response)
        let rows = (try? JSONDecoder().decode([StandingRow].self, from: data)) ?? []
        var result: [String: DeadlineStanding] = [:]
        for row in rows {
            result[row.deadline_id] = DeadlineStanding(confirmCount: row.confirm_count,
                                                       confirmedByMe: row.mine ?? false)
        }
        return result
    }

    public func confirm(deadlineID: String, confirmerID: String) async throws {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/\(confirmationTable)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // `ON CONFLICT DO NOTHING`: confirming twice is a no-op, not a second vote. See
        // the note in `SupabaseCancellationStore.submit` for why not `merge-duplicates`.
        request.setValue("resolution=ignore-duplicates", forHTTPHeaderField: "Prefer")
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

    // MARK: Moderation

    public func report(deadlineID: String, reason: DeadlineReportReason) async throws {
        _ = try await rpc("report_deadline", ["p_deadline": deadlineID, "p_reason": reason.rawValue])
    }

    public func hideAuthor(ofDeadlineID deadlineID: String) async throws {
        _ = try await rpc("hide_author_of", ["p_deadline": deadlineID])
    }

    public func hiddenAuthorCount() async throws -> Int {
        let data = try await rpc("hidden_author_count", [:])
        return (try? JSONDecoder().decode(Int.self, from: data)) ?? 0
    }

    public func unhideAllAuthors() async throws {
        _ = try await rpc("unhide_all_authors", [:])
    }

    private func rpc(_ name: String, _ arguments: [String: String]) async throws -> Data {
        var request = URLRequest(url: URL(string: "\(config.url)/rest/v1/rpc/\(name)")!)
        request.httpMethod = "POST"
        await apply(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(arguments)
        let (data, response) = try await session.data(for: request)
        try check(response)
        return data
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
        DeadlineRules.upcoming(load().filter { $0.moduleKey == moduleKey })
    }

    public func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline] {
        let wanted = Set(moduleKeys)
        return DeadlineRules.upcoming(load().filter { wanted.contains($0.moduleKey) })
    }

    public func submit(_ deadline: Deadline) async throws {
        var all = load()
        all.append(deadline)
        save(all)
    }

    public func withdraw(id: String, submitterID: String) async throws {
        save(load().filter { !($0.id == id && $0.submitterID == submitterID) })
    }

    public func standings(forDeadlineIDs ids: [String]) async throws -> [String: DeadlineStanding] {
        let wanted = Set(ids)
        let mine = loadConfirmations().filter { wanted.contains($0.deadlineID) }
        return DeadlineRules.standings(counts: mine.reduce(into: [:]) { $0[$1.deadlineID, default: 0] += 1 },
                                       mine: Set(mine.map(\.deadlineID)))
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
