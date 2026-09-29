import Foundation
import HealthMateCore
import Security

/// Stores session tokens in the iOS Keychain, readable only on this device
/// after first unlock (never synced to iCloud, never in UserDefaults).
/// If the Keychain refuses a write (e.g. unsigned simulator builds), the
/// session is kept in memory for this launch only.
actor KeychainTokenStore: TokenStore {
    private let service = "com.healthmate.session"
    private let account = "tokens"
    private var memory: SessionTokens?

    func load() async -> SessionTokens? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return memory }
        return (try? JSONDecoder().decode(SessionTokens.self, from: data)) ?? memory
    }

    func save(_ tokens: SessionTokens) async {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = baseQuery
            insert.merge(attributes) { $1 }
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        if status == errSecSuccess {
            memory = nil
        } else {
            // Don't let an older Keychain session shadow the new one.
            SecItemDelete(baseQuery as CFDictionary)
            memory = tokens
        }
    }

    func clear() async {
        memory = nil
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
