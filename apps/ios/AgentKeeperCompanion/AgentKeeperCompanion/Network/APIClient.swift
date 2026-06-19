import Foundation

enum APIError: Error {
    case unauthorized, notFound, serverError(Int), decodingError(Error), networkError(Error)
}

actor APIClient {
    private let config: AppConfig
    private let session = URLSession.shared

    init(config: AppConfig) { self.config = config }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        let fullURL = await config.baseURL + path
        guard let url = URL(string: fullURL) else {
            print("[Companion] request: bad URL \(fullURL)")
            throw APIError.serverError(0)
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = method
        req.setValue("Bearer \(await config.secretKey)", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        print("[Companion] -> \(method) \(fullURL)")
        do {
            let (data, resp) = try await session.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let preview = String(data: data.prefix(200), encoding: .utf8) ?? "<\(data.count) bytes>"
            print("[Companion] <- \(code) \(method) \(path) bytes=\(data.count) body=\(preview)")
            if code == 401 { throw APIError.unauthorized }
            if code == 404 { throw APIError.notFound }
            if code < 200 || code >= 300 { throw APIError.serverError(code) }
            return data
        } catch let e as APIError { throw e }
        catch {
            print("[Companion] xx \(method) \(path) network error: \(error.localizedDescription)")
            throw APIError.networkError(error)
        }
    }

    func health() async throws -> Bool {
        _ = try await request("/api/health")
        return true
    }

    func listSessions() async throws -> [SessionSummary] {
        let data = try await request("/api/sessions")
        return try JSONDecoder().decode([SessionSummary].self, from: data)
    }

    func getSession(id: String) async throws -> SessionDetail {
        let data = try await request("/api/sessions/\(id)")
        return try JSONDecoder().decode(SessionDetail.self, from: data)
    }

    func getEvents(id: String, limit: Int = 25, before: String? = nil) async throws -> [LiveEvent] {
        var path = "/api/sessions/\(id)/events?limit=\(limit)"
        if let before { path += "&before=\(before)" }
        let data = try await request(path)
        do {
            let events = try JSONDecoder().decode([LiveEvent].self, from: data)
            print("[Companion] getEvents: decoded \(events.count) events for session \(id) limit=\(limit) before=\(before ?? "none")")
            return events
        } catch {
            print("[Companion] getEvents: decode FAILED for session \(id): \(error)")
            throw APIError.decodingError(error)
        }
    }

    func newSessionOptions(projectPath: String? = nil) async throws -> NewSessionOptions {
        var path = "/api/new-session/options"
        if let projectPath {
            let encoded = projectPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? projectPath
            path += "?projectPath=\(encoded)"
        }
        let data = try await request(path)
        return try JSONDecoder().decode(NewSessionOptions.self, from: data)
    }

    func createSession(_ body: [String: Any]) async throws -> String {
        let data = try JSONSerialization.data(withJSONObject: body)
        let resp = try await request("/api/sessions", method: "POST", body: data)
        return try JSONDecoder().decode(CreateSessionResponse.self, from: resp).sessionId
    }

    func listCommands(sessionId: String) async throws -> [SlashCommand] {
        let data = try await request("/api/sessions/\(sessionId)/commands")
        return try JSONDecoder().decode([SlashCommand].self, from: data)
    }

    func sendInput(sessionId: String, text: String) async throws {
        let body = try JSONEncoder().encode(["text": text])
        _ = try await request("/api/sessions/\(sessionId)/input", method: "POST", body: body)
    }

    func interrupt(sessionId: String) async throws {
        _ = try await request("/api/sessions/\(sessionId)/interrupt", method: "POST")
    }
}
