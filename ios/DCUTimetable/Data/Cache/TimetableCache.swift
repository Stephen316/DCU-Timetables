import Foundation

/// A cached timetable snapshot for one programme + week, for offline-first loading.
public struct TimetableSnapshot: Codable, Sendable, Equatable {
    public let category: TimetableCategory
    public let weekNumber: Int
    public let events: [TimetableEvent]
    public let fetchedAt: Date

    public init(category: TimetableCategory, weekNumber: Int,
                events: [TimetableEvent], fetchedAt: Date) {
        self.category = category
        self.weekNumber = weekNumber
        self.events = events
        self.fetchedAt = fetchedAt
    }
}

/// On-disk cache of timetable snapshots (JSON in Application Support).
/// Offline-first: read the cache immediately, refresh in the background, and use
/// `fetchedAt` to show the user how stale the data is.
public actor TimetableCache {
    private let directory: URL

    public init(directoryName: String = "TimetableCache") {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.directory = base.appendingPathComponent(directoryName, isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public func snapshot(categoryID: String, weekNumber: Int) -> TimetableSnapshot? {
        let url = fileURL(categoryID: categoryID, weekNumber: weekNumber)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(TimetableSnapshot.self, from: data)
    }

    public func store(_ snapshot: TimetableSnapshot) {
        let url = fileURL(categoryID: snapshot.category.identity, weekNumber: snapshot.weekNumber)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func fileURL(categoryID: String, weekNumber: Int) -> URL {
        let safe = categoryID.replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent("\(safe)-w\(weekNumber).json")
    }
}
