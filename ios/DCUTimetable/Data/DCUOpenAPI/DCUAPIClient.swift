import Foundation

/// Live client for DCU's public MyTimetable v4 API (anonymous guest access).
/// See docs/API.md for the full endpoint reference.
public struct DCUAPIClient: TimetableSource {

    public struct Config: Sendable {
        public var apiBase: URL
        public var institutionID: String

        public init(apiBase: URL, institutionID: String) {
            self.apiBase = apiBase
            self.institutionID = institutionID
        }

        /// Verified values for DCU (2026-09-15). The host is versioned and read from the
        /// web app at runtime — see docs/API.md; long-term it should be re-derived, not
        /// pinned here.
        public static let dcu = Config(
            apiBase: URL(string: "https://scientia-eu-v4-api-d1-03.azurewebsites.net/api")!,
            institutionID: "a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177"
        )
    }

    private let config: Config
    private let session: URLSession

    public init(config: Config = .dcu, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // MARK: - TimetableSource

    public func searchProgrammes(query: String, page: Int) async throws -> [TimetableCategory] {
        // The search term goes in the URL query string — the endpoint ignores a body
        // `query` and just pages through everything (see docs/API.md). Body is the (empty)
        // parent-filter list.
        let path = "Public/CategoryTypes/\(CategoryType.programme.rawValue)/Categories/FilterWithCache/\(config.institutionID)"
        var components = URLComponents(
            url: config.apiBase.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "itemsPerPage", value: "50"),
            URLQueryItem(name: "pageNumber", value: String(page)),
            URLQueryItem(name: "returnOccurrences", value: "false"),
        ]
        let response: CategoryFilterResponseDTO = try await postURL(components.url!, body: [String]())
        return response.results.map {
            TimetableCategory(
                identity: $0.identity,
                name: $0.name,
                categoryTypeIdentity: $0.categoryTypeIdentity ?? CategoryType.programme.rawValue
            )
        }
    }

    public func weekCalendar() async throws -> WeekCalendar {
        let vo = try await rawViewOptions()
        let weeks = vo.weeks.compactMap { dto -> TeachingWeek? in
            guard let first = APIDate.date(from: dto.firstDayInWeek) else { return nil }
            return TeachingWeek(number: dto.weekNumber, label: dto.weekLabel, firstDay: first)
        }
        let days = vo.days.map { DayOption(name: $0.name, dayOfWeek: $0.dayOfWeek) }
        return WeekCalendar(weeks: weeks, days: days)
    }

    public func events(for category: TimetableCategory, weeks: [TeachingWeek]) async throws -> [TimetableEvent] {
        let vo = try await rawViewOptions()
        let wanted = Set(weeks.map(\.number))
        let weekDTOs = vo.weeks
            .filter { wanted.contains($0.weekNumber) }
            .sorted { $0.weekNumber < $1.weekNumber }
        guard !weekDTOs.isEmpty else { return [] }

        let allDay = TimePeriodDTO(description: "All Day", startTime: "00:00",
                                   endTime: "23:59", isDefault: true)
        let datePeriod = datePeriod(spanning: weekDTOs)

        let request = EventsRequestDTO(
            viewOptions: ViewOptionsRequestDTO(
                days: vo.days,
                weeks: weekDTOs,
                timePeriods: [allDay],
                datePeriods: [datePeriod]
            ),
            categoryTypesWithIdentities: [
                CategoryTypeWithIdentitiesDTO(
                    categoryTypeIdentity: category.categoryTypeIdentity,
                    categoryIdentities: [category.identity]
                )
            ],
            fetchBookings: false,
            fetchPersonalEvents: false,
            personalIdentities: []
        )

        let path = "Public/CategoryTypes/Categories/Events/Filter/\(config.institutionID)"
        let response: EventsResponseDTO = try await post(path, body: request)
        return EventMapper.events(from: response)
    }

    // MARK: - Internals

    private func rawViewOptions() async throws -> ViewOptionsDTO {
        try await get("Public/ViewOptions/\(config.institutionID)")
    }

    private func datePeriod(spanning weeks: [WeekDTO]) -> DatePeriodDTO {
        let startStr = weeks.first?.firstDayInWeek ?? APIDate.string(from: Date())
        let lastStart = weeks.last.flatMap { APIDate.date(from: $0.firstDayInWeek) } ?? Date()
        let end = lastStart.addingTimeInterval(7 * 24 * 60 * 60)
        return DatePeriodDTO(description: "Range", startDateTime: startStr,
                             endDateTime: APIDate.string(from: end), isDefault: true, type: nil)
    }

    // MARK: - HTTP

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(request(path: path, method: "GET", body: Optional<Int>.none))
    }

    private func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        try await send(request(url: config.apiBase.appendingPathComponent(path), method: "POST", body: body))
    }

    private func postURL<Body: Encodable, T: Decodable>(_ url: URL, body: Body) async throws -> T {
        try await send(request(url: url, method: "POST", body: body))
    }

    private func request<Body: Encodable>(path: String, method: String, body: Body?) throws -> URLRequest {
        try request(url: config.apiBase.appendingPathComponent(path), method: method, body: body)
    }

    private func request<Body: Encodable>(url: URL, method: String, body: Body?) throws -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Anonymous", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("https://mytimetable.dcu.ie", forHTTPHeaderField: "Origin")
        req.setValue("https://mytimetable.dcu.ie/", forHTTPHeaderField: "Referer")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw TimetableSourceError.http(status: http.statusCode)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw TimetableSourceError.decoding(String(describing: error))
        }
    }
}
