import Foundation

struct SessionDraft: Codable, Identifiable {
    var id: UUID
    var createdAt: Date
    var projectPath: String
    var prompt: String
    var model: String
    var roleId: String
    var agencyKey: String
    var effort: String
    var permissionMode: String
    var useWorktree: Bool
    var branch: String
    // Optional so drafts saved before image support still decode.
    var attachments: [AttachmentPayload]?

    var projectName: String {
        URL(fileURLWithPath: projectPath).lastPathComponent
    }
}

@MainActor
final class DraftStore: ObservableObject {
    static let shared = DraftStore()

    @Published private(set) var drafts: [SessionDraft] = []

    private static let defaultsKey = "sessionDrafts"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
           let decoded = try? JSONDecoder().decode([SessionDraft].self, from: data) {
            drafts = decoded
        }
    }

    func save(_ draft: SessionDraft) {
        if let i = drafts.firstIndex(where: { $0.id == draft.id }) {
            drafts[i] = draft
        } else {
            drafts.insert(draft, at: 0)
        }
        persist()
    }

    func delete(_ id: UUID) {
        drafts.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(drafts) {
            UserDefaults.standard.set(data, forKey: Self.defaultsKey)
        }
    }
}
