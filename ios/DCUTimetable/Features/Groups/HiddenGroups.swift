import Foundation

/// Encoding helpers for the set of group keys a student has turned OFF.
/// Stored (as JSON `Data`) in `@AppStorage("hiddenGroups")`. Empty = show every group.
enum HiddenGroups {
    static func decode(_ data: Data) -> Set<String> {
        (try? JSONDecoder().decode(Set<String>.self, from: data)) ?? []
    }
    static func encode(_ set: Set<String>) -> Data {
        (try? JSONEncoder().encode(set)) ?? Data()
    }
}
