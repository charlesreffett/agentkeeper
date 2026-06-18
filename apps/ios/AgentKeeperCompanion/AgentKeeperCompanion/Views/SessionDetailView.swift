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
    @State private var didInitialScroll = false
    @State private var visibleCount = SessionDetailView.pageSize

    // Render only the latest `visibleCount` turns. A full transcript is held in
    // `events` but drawing all of it eagerly is expensive on long sessions, so the
    // view starts at one page and grows via "Load older". Pagination (V-next) will
    // swap the array itself to a fetched window without touching this view shape.
    private static let pageSize = 25

    enum WSState { case connecting, connected, disconnected }

    private var client: APIClient { APIClient(config: config) }

    // Live tool-only turns have no prose — drop them so the chat reads cleanly.
    private var visibleEvents: [LiveEvent] {
        events.filter { !$0.displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    // The tail slice actually rendered. `suffix` keeps the latest turns, so live
    // appends stay in-window automatically.
    private var windowedEvents: [LiveEvent] {
        let v = visibleEvents
        return v.count > visibleCount ? Array(v.suffix(visibleCount)) : v
    }

    private var hasOlder: Bool { visibleEvents.count > visibleCount }

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
                    // Plain VStack, not LazyVStack: a chat is a finite list of
                    // text-only turns, and lazy rows that aren't measured until they
                    // scroll on-screen made scrollTo land short and the view open
                    // blank. Eager layout makes scrollTo("bottom") land first try.
                    VStack(alignment: .leading, spacing: 8) {
                        if hasOlder {
                            Button("Load older messages") {
                                visibleCount += Self.pageSize
                            }
                            .font(.caption)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        ForEach(windowedEvents) { event in
                            EventBubble(event: event)
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding()
                }
                .onChange(of: visibleEvents.count) { _, _ in
                    // First settle = jump without animation so the view opens at the
                    // latest message; later live appends animate. Defer past the
                    // current frame: history bulk-load + WS appends can change the
                    // count several times per frame, and scrolling synchronously trips
                    // "tried to update multiple times per frame".
                    let animated = didInitialScroll
                    didInitialScroll = true
                    Task { @MainActor in
                        if animated {
                            withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                        } else {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
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
            // Active sessions replay buffered events on subscribe, which overlap the
            // REST history we already loaded. Skip dupes so the count doesn't churn
            // (which would re-trigger scrolling and flicker rows).
            guard !event.displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            if events.contains(where: { $0.dedupKey == event.dedupKey }) { continue }
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
                Text(displayText)
                    .font(.body)
                    .textSelection(.enabled)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isUser ? Color.blue.opacity(0.2) : Color.secondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            if !isUser { Spacer(minLength: 40) }
        }
    }
}
