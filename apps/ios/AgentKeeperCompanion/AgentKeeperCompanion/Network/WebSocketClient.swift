import Foundation

actor WebSocketClient {
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<LiveEvent>.Continuation?

    func connect(baseURL: String, secretKey: String, sessionId: String) -> AsyncStream<LiveEvent> {
        let wsURL = baseURL.replacingOccurrences(of: "http://", with: "ws://")
                           .replacingOccurrences(of: "https://", with: "wss://")
        guard let url = URL(string: wsURL + "/ws") else {
            return AsyncStream { $0.finish() }
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(secretKey)", forHTTPHeaderField: "Authorization")
        let t = URLSession.shared.webSocketTask(with: req)
        self.task = t

        // makeStream() returns (stream, continuation) in actor-isolated scope —
        // no nonisolated closure, so self.continuation assignment is safe here.
        let (stream, cont) = AsyncStream<LiveEvent>.makeStream()
        self.continuation = cont
        t.resume()
        let msg = #"{"type":"subscribe","sessionId":"\#(sessionId)"}"#
        t.send(.string(msg)) { _ in }
        Task { await self.receiveLoop(task: t, continuation: cont) }
        cont.onTermination = { [weak self] _ in Task { await self?.disconnect() } }
        return stream
    }

    private func receiveLoop(task: URLSessionWebSocketTask, continuation: AsyncStream<LiveEvent>.Continuation) async {
        while true {
            do {
                let msg = try await task.receive()
                if case .string(let str) = msg, let data = str.data(using: .utf8) {
                    if let event = try? JSONDecoder().decode(LiveEvent.self, from: data) {
                        continuation.yield(event)
                    }
                }
            } catch {
                continuation.finish()
                break
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        continuation?.finish()
    }
}
