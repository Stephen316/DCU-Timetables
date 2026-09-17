import Foundation

/// Classes the student has marked "I won't attend".
///
/// Deliberately device-local and never shared: unlike a cancellation, this is a private
/// choice about one person's day, and uploading it would turn the app into an attendance
/// record. Stored as a plain set of event keys under one `@AppStorage` blob so the views
/// re-render the moment it changes.
public enum Attendance {
    public static let storageKey = "skippedEvents"

    public static func decode(_ data: Data) -> Set<String> {
        (try? JSONDecoder().decode(Set<String>.self, from: data)) ?? []
    }

    public static func encode(_ keys: Set<String>) -> Data {
        (try? JSONEncoder().encode(keys)) ?? Data()
    }

    public static func toggling(_ key: String, in keys: Set<String>) -> Set<String> {
        var updated = keys
        if updated.contains(key) { updated.remove(key) } else { updated.insert(key) }
        return updated
    }
}
