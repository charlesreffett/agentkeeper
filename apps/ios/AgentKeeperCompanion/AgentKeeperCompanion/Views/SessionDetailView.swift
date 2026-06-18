import SwiftUI

@MainActor
struct SessionDetailView: View {
    let session: SessionSummary
    @ObservedObject var config: AppConfig

    @State private var detail: SessionDetail? = nil
    @State private var events: [LiveEvent] = []
    @State private var inputText = ""
    @State private var wsState: WSState = .connecting
    @State private var error: String? = nil
    @State private var wsClient = WebSocketClient()

    enum WSState { case connecting, connected, disconnected }

    private var client: APIClient { APIClient(config: config) }

    var body: some View {
        VStack(spacing: 0) {
            if wsState == .connecting {
                HStack {
                    ProgressView().scaleEffect(0.7)
                    Text("Connecting…").font(.caption).foregroundStyle(.secondary)
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(Color.yellow.opacity(0.15))
            } else if wsState == .disconnected {
                HStack {
                    Text("Disconnected").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") { Task { await startWebSocket() } }
                        .font(.caption)
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(Color.red.opacity(0.1))
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(events.enumerated()), id: \.offset) { _, event in
                            EventBubble(event: event)
                        }
                    }
                    .padding()
                    .id("bottom")
                }
                .onChange(of: events.count) { _, _ in
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }

            Divider()

            HStack(spacing: 8) {
                TextField("Message…", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { sendInput() }
                Button(action: sendInput) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
                Button(action: { Task { try? await client.interrupt(sessionId: session.localId) } }) {
                    Image(systemName: "stop.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.red)
                }
            }
            .padding(12)
        }
        .navigationTitle(session.title ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadDetail()
            await startWebSocket()
        }
    }

    private func loadDetail() async {
        do {
            detail = try await client.getSession(id: session.localId)
        } catch {
            self.error = error.localizedDescription
        }
        if let history = try? await client.getEvents(id: session.localId) {
            events = history
        }
    }

    private func startWebSocket() async {
        wsState = .connecting
        let stream = await wsClient.connect(
            baseURL: config.baseURL,
            secretKey: config.secretKey,
            sessionId: session.localId
        )
        wsState = .connected
        for await event in stream {
            events.append(event)
        }
        wsState = .disconnected
    }

    private func sendInput() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        inputText = ""
        Task {
            try? await client.sendInput(sessionId: session.localId, text: text)
        }
    }
}

private struct EventBubble: View {
    let event: LiveEvent

    private var isUser: Bool { event.message?.type == "user" }
    private var eventType: String { event.message?.type ?? "unknown" }
    private var displayText: String { event.message?.message?.textContent ?? "" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 2) {
                Text(eventType)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if !displayText.isEmpty {
                    Text(displayText)
                        .font(.body)
                        .multilineTextAlignment(isUser ? .trailing : .leading)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isUser ? Color.blue.opacity(0.2) : Color.secondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            if !isUser { Spacer(minLength: .infinity) }
        }
    }
}
