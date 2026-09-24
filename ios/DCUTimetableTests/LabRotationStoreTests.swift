import Foundation
import Testing
@testable import DCUTimetable

struct SavedLabRotationDecodeTests {

    @Test func decodesTheEmbeddedSessions() throws {
        let json = """
        [{"version":3,"title":"Semester 1","lab_rotation_sessions":[
          {"week":2,"date":"2026-09-17","day":"Thu","start_time":"14:00","end_time":"17:00",
           "module":"EEG1002","activity":"Lab","groups":["A","B","E"]}]}]
        """
        let saved = try #require(try SavedLabRotation.decode(Data(json.utf8)))
        #expect(saved.version == 3)
        #expect(saved.sessions == [LabSession(week: 2, date: "2026-09-17", day: "Thu", start: "14:00", end: "17:00",
                                              module: "EEG1002", activity: "Lab", groups: ["A", "B", "E"])])
    }

    @Test func nothingSavedIsNil() throws {
        #expect(try SavedLabRotation.decode(Data("[]".utf8)) == nil)
    }

    /// A session with no date can't be put on a day; placing it anyway would be a guess.
    @Test func unplaceableSessionsAreLeftOut() throws {
        let json = """
        [{"version":1,"title":null,"lab_rotation_sessions":[
          {"week":2,"date":null,"day":"Thu","start_time":"14:00","end_time":"17:00","module":"EEG1002","activity":"Lab","groups":["A"]},
          {"week":2,"date":"2026-09-17","day":"Thu","start_time":"14:00","end_time":"17:00","module":"EEG1002","activity":"Lab","groups":[]},
          {"week":2,"date":"2026-09-17","day":"Thu","start_time":"14:00","end_time":"17:00","module":"EEG1002","activity":null,"groups":["C"]}]}]
        """
        let saved = try #require(try SavedLabRotation.decode(Data(json.utf8)))
        #expect(saved.sessions.count == 1)
        #expect(saved.sessions.first?.activity == "")
    }
}

struct LabRotationRefreshTests {

    private final class FakeStore: LabRotationStore, @unchecked Sendable {
        var saved: SavedLabRotation?
        var failing = false
        private(set) var rotationCalls = 0

        init(_ saved: SavedLabRotation?) { self.saved = saved }

        func version(courseKey: String) async throws -> Int? {
            if failing { throw URLError(.notConnectedToInternet) }
            return saved?.version
        }
        func rotation(courseKey: String) async throws -> SavedLabRotation? {
            rotationCalls += 1
            return saved
        }
    }

    private let session = LabSession(week: 5, date: "2026-10-08", day: "Thu", start: "14:00", end: "17:00",
                                     module: "EEG1002", activity: "Lab", groups: ["C"])
    private let bundled = LabRotation(title: "Bundled",
                                      modules: ["EEG1002": .init(name: "EEG1002 Programming")],
                                      sessions: [])

    private func freshCache() -> LabRotationCache {
        LabRotationCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("LabRotationTests-\(UUID().uuidString)", isDirectory: true))
    }

    @Test func aNewVersionIsDownloadedWithBundledNames() async {
        let cache = freshCache()
        let store = FakeStore(SavedLabRotation(version: 2, title: nil, sessions: [session]))
        #expect(await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled))
        let entry = cache.entry(courseKey: "EEG1")
        #expect(entry?.version == 2)
        #expect(entry?.rotation.sessions == [session])
        #expect(entry?.rotation.name(for: "EEG1002") == "EEG1002 Programming")
        #expect(entry?.rotation.title == "Bundled")
    }

    @Test func theSameVersionIsNotDownloadedAgain() async {
        let cache = freshCache()
        let store = FakeStore(SavedLabRotation(version: 2, title: nil, sessions: [session]))
        _ = await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled)
        #expect(await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled) == false)
        #expect(store.rotationCalls == 1)
    }

    /// Offline must not put the bundled rotation back over a correction.
    @Test func aFailedRequestKeepsTheCachedRotation() async {
        let cache = freshCache()
        let store = FakeStore(SavedLabRotation(version: 2, title: nil, sessions: [session]))
        _ = await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled)
        store.failing = true
        #expect(await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled) == false)
        #expect(cache.entry(courseKey: "EEG1")?.version == 2)
    }

    @Test func deletedInTheConsoleFallsBackToBundled() async {
        let cache = freshCache()
        let store = FakeStore(SavedLabRotation(version: 2, title: nil, sessions: [session]))
        _ = await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled)
        store.saved = nil
        #expect(await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled))
        #expect(cache.entry(courseKey: "EEG1") == nil)
    }

    /// A saved rotation whose every session was unplaceable would blank a student's labs.
    @Test func anEmptyRotationIsNotCached() async {
        let cache = freshCache()
        let store = FakeStore(SavedLabRotation(version: 2, title: nil, sessions: []))
        #expect(await LabRotationRefresh.run(courseKey: "EEG1", store: store, cache: cache, bundled: bundled) == false)
        #expect(cache.entry(courseKey: "EEG1") == nil)
    }
}
