import Foundation
import Security

final class AppConfig: ObservableObject {
    static let shared = AppConfig()

    @Published var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: "baseURL") }
    }
    @Published var secretKey: String

    private init() {
        self.baseURL = UserDefaults.standard.string(forKey: "baseURL") ?? ""
        self.secretKey = AppConfig.loadKey() ?? ""
    }

    func save(baseURL: String, secretKey: String) {
        self.baseURL = baseURL
        self.secretKey = secretKey
        AppConfig.saveKey(secretKey)
    }

    var isConfigured: Bool { !baseURL.isEmpty && !secretKey.isEmpty }

    // MARK: Keychain
    private static let keychainService = "com.agentkeeper.companion"
    private static let keychainAccount = "secretKey"

    static func loadKey() -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: keychainAccount,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveKey(_ key: String) {
        guard let data = key.data(using: .utf8) else { return }
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: keychainAccount
        ]
        let attributes: [CFString: Any] = [kSecValueData: data]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var add = query
            add[kSecValueData] = data
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
