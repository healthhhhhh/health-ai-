import Foundation
import HealthMateCore
import Security

/// Stores session tokens in the iOS Keychain, readable only on this device
/// after first unlock (never synced to iCloud, never in UserDefaults).
actor KeychainTokenStore: TokenStore {
    private let service = "com.healthmate.session"
    private let account = "tokens"

    func load() async -> SessionTokens? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(SessionTokens.self, from: data)
    }

    func save(_ tokens: SessionTokens) async {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var insert = baseQuery
            insert.merge(attributes) { $1 }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    func clear() async {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
