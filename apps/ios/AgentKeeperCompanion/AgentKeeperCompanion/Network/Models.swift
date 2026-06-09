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

struct HarnessEvent: Codable {
    let type: String
    let sessionId: String?
    let content: AnyCodable?
}

enum AnyCodable: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case dict([String: AnyCodable])
    case array([AnyCodable])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Int.self) { self = .int(v) }
        else if let v = try? c.decode(Double.self) { self = .double(v) }
        else if let v = try? c.decode([String: AnyCodable].self) { self = .dict(v) }
        else if let v = try? c.decode([AnyCodable].self) { self = .array(v) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .dict(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
