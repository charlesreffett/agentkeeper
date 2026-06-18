import Foundation

enum APIError: Error {
    case unauthorized, notFound, serverError(Int), decodingError(Error), networkError(Error)
}

actor APIClient {
    private let config: AppConfig
    private let session = URLSession.shared

    init(config: AppConfig) { self.config = config }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        guard let url = URL(string: await config.baseURL + path) else { throw APIError.serverError(0) }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = method
        req.setValue("Bearer \(await config.secretKey)", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        do {
            let (data, resp) = try await session.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 { throw APIError.unauthorized }
            if code == 404 { throw APIError.notFound }
            if code < 200 || code >= 300 { throw APIError.serverError(code) }
            return data
        } catch let e as APIError { throw e }
        catch { throw APIError.networkError(error) }
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

    func getEvents(id: String) async throws -> [LiveEvent] {
        let data = try await request("/api/sessions/\(id)/events")
        return try JSONDecoder().decode([LiveEvent].self, from: data)
    }

    func sendInput(sessionId: String, text: String) async throws {
        let body = try JSONEncoder().encode(["text": text])
        _ = try await request("/api/sessions/\(sessionId)/input", method: "POST", body: body)
    }

    func interrupt(sessionId: String) async throws {
        _ = try await request("/api/sessions/\(sessionId)/interrupt", method: "POST")
    }
}
