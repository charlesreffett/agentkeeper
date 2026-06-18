import Foundation

struct SessionSummary: Codable, Identifiable {
    let localId: String
    let projectPath: String
    let title: String?
    let initialPrompt: String?
    let model: String?
    let status: String
    let startedAt: Double
    let lastActivityAt: Double?
    var id: String { localId }
}

struct SessionDetail: Codable {
    let session: SessionSummary
    let agents: [AgentSummary]
}

struct AgentSummary: Codable, Identifiable {
    let localId: String
    let roleName: String?
    let status: String
    let isEntryPoint: Bool
    var id: String { localId }
}

struct LiveEvent: Codable {
    let sessionId: String?
    let agentLocalId: String?
    let message: EventMessage?

    var displayText: String { message?.message?.textContent ?? "" }
    var isUser: Bool { message?.type == "user" }
}

struct EventMessage: Codable {
    let type: String
    let message: MessageBody?
    let subtype: String?
}

struct MessageBody: Codable {
    let role: String?
    let content: ContentValue?

    enum CodingKeys: String, CodingKey { case role, content }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try? c.decode(String.self, forKey: .role)
        if let s = try? c.decode(String.self, forKey: .content) {
            content = .text(s)
        } else if let blocks = try? c.decode([ContentBlock].self, forKey: .content) {
            content = .blocks(blocks)
        } else {
            content = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try? c.encode(role, forKey: .role)
        switch content {
        case .text(let s): try? c.encode(s, forKey: .content)
        case .blocks(let bs): try? c.encode(bs, forKey: .content)
        case nil: break
        }
    }

    enum ContentValue {
        case text(String)
        case blocks([ContentBlock])
    }

    var textContent: String {
        switch content {
        case .text(let s): return s
        case .blocks(let bs): return bs.compactMap { $0.text }.joined(separator: "\n")
        case nil: return ""
        }
    }
}

struct ContentBlock: Codable {
    let type: String
    let text: String?
}
