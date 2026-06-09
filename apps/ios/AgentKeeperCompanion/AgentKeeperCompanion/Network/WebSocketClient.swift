import Foundation

actor WebSocketClient {
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<HarnessEvent>.Continuation?

    func connect(baseURL: String, secretKey: String, sessionId: String) -> AsyncStream<HarnessEvent> {
        let wsURL = baseURL.replacingOccurrences(of: "http://", with: "ws://")
                           .replacingOccurrences(of: "https://", with: "wss://")
        guard let url = URL(string: wsURL + "/ws") else {
            return AsyncStream { $0.finish() }
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(secretKey)", forHTTPHeaderField: "Authorization")
        let t = URLSession.shared.webSocketTask(with: req)
        self.task = t

        return AsyncStream { [weak self] continuation in
            self?.continuation = continuation
            t.resume()
            let msg = #"{"type":"subscribe","sessionId":"\#(sessionId)"}"#
            t.send(.string(msg)) { _ in }
            Task { [weak self] in await self?.receiveLoop(task: t, continuation: continuation) }
            continuation.onTermination = { [weak self] _ in Task { await self?.disconnect() } }
        }
    }

    private func receiveLoop(task: URLSessionWebSocketTask, continuation: AsyncStream<HarnessEvent>.Continuation) async {
        while true {
            do {
                let msg = try await task.receive()
                if case .string(let str) = msg, let data = str.data(using: .utf8) {
                    if let event = try? JSONDecoder().decode(HarnessEvent.self, from: data) {
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
