import Foundation
import Security

/// Minimal Keychain wrapper for the one thing that genuinely must not live in
/// `UserDefaults`: the student's Supabase session tokens. A token is a bearer credential —
/// anyone holding it can act as that account until it expires.
enum Keychain {
    private static let service = "ie.dcu.timetable.auth"

    static func save(_ data: Data, key: String) {
        var query = baseQuery(key)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        // Device-only: a session restored onto another device from an iCloud backup would
        // be a sign-in the student never performed.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func read(key: String) -> Data? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    static func delete(key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }

    private static func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
