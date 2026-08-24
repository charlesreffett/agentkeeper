import Foundation

// Caches NewSessionOptions per project so the New Session form works offline.
// Entries refresh lazily when older than the TTL, or on explicit re-sync.
@MainActor
final class OptionsStore: ObservableObject {
    static let shared = OptionsStore()
    static let ttl: TimeInterval = 3600

    @Published private(set) var lastSyncedAt: Date?

    private struct CacheEntry: Codable {
        let savedAt: Date
        let options: NewSessionOptions
    }

    private var entries: [String: CacheEntry]

    private static let entriesKey = "cachedNewSessionOptions"
    private static let syncedAtKey = "optionsLastSyncedAt"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.entriesKey),
           let decoded = try? JSONDecoder().decode([String: CacheEntry].self, from: data) {
            entries = decoded
        } else {
            entries = [:]
        }
        let t = UserDefaults.standard.double(forKey: Self.syncedAtKey)
        lastSyncedAt = t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    private func key(_ projectPath: String?) -> String { projectPath ?? "" }

    func cached(projectPath: String?) -> NewSessionOptions? {
        entries[key(projectPath)]?.options
    }

    func isStale(projectPath: String?) -> Bool {
        guard let entry = entries[key(projectPath)] else { return true }
        return Date().timeIntervalSince(entry.savedAt) > Self.ttl
    }

    @discardableResult
    func sync(client: APIClient, projectPath: String? = nil) async throws -> NewSessionOptions {
        let opts = try await client.newSessionOptions(projectPath: projectPath)
        entries[key(projectPath)] = CacheEntry(savedAt: Date(), options: opts)
        lastSyncedAt = Date()
        persist()
        return opts
    }

    func syncIfStale(client: APIClient) async {
        guard isStale(projectPath: nil) else { return }
        _ = try? await sync(client: client)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: Self.entriesKey)
        }
        UserDefaults.standard.set(lastSyncedAt?.timeIntervalSince1970 ?? 0, forKey: Self.syncedAtKey)
    }
}
