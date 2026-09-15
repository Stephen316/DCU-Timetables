import Foundation

/// Converts API event DTOs into the Core `TimetableEvent` domain type.
enum EventMapper {

    static func event(from dto: EventDTO) -> TimetableEvent? {
        guard let startStr = dto.startDateTime, let endStr = dto.endDateTime,
              let start = APIDate.date(from: startStr), let end = APIDate.date(from: endStr)
        else { return nil }

        let extras = extraProperties(dto.extraProperties)
        let moduleName = nonEmpty(extras["Module Name"])
        let staffValue = nonEmpty(extras["Staff Member"])

        return TimetableEvent(
            id: dto.identity ?? UUID().uuidString,
            start: start,
            end: end,
            type: EventType(apiValue: dto.eventType),
            locations: locations(from: dto.location),
            moduleName: moduleName,
            staff: staffValue.map { [$0] } ?? [],
            activity: ActivityCode(dto.name ?? ""),
            weekLabels: weekLabels(from: dto.weekLabels)
        )
    }

    static func events(from response: EventsResponseDTO) -> [TimetableEvent] {
        (response.categoryEvents ?? [])
            .flatMap { $0.results ?? [] }
            .compactMap(event(from:))
            .sorted { $0.start < $1.start }
    }

    // MARK: - Helpers

    static func locations(from raw: String?) -> [String] {
        guard let raw, !raw.isEmpty else { return [] }
        return raw
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private static func extraProperties(_ props: [ExtraPropertyDTO]?) -> [String: String] {
        let pairs = (props ?? []).compactMap { p -> (String, String)? in
            guard let n = p.name, let v = p.value else { return nil }
            return (n, v)
        }
        return Dictionary(pairs, uniquingKeysWith: { first, _ in first })
    }

    static func weekLabels(from raw: String?) -> [String] {
        guard let raw, !raw.isEmpty else { return [] }
        return raw
            .split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return s
    }
}
