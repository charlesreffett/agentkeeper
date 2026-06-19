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
    @State private var hasMoreOlder = false
    @State private var loadingOlder = false
    @State private var suppressBottomScroll = false
    @State private var isRunning = false
    @State private var commands: [SlashCommand] = []
    @State private var showCommands = false
    @FocusState private var inputFocused: Bool

    // `events` now holds only a fetched window — the latest page on open, grown
    // toward the top as the user pulls in older pages. Memory is bounded to what's
    // been fetched rather than the whole transcript.
    private static let pageSize = 25

    enum WSState { case connecting, connected, disconnected }

    private var client: APIClient { APIClient(config: config) }

    // Live tool-only turns have no prose — drop them so the chat reads cleanly.
    private var visibleEvents: [LiveEvent] {
        events.filter { !$0.displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    // Inline picker: shown while the user types a `/<prefix>` with no space yet.
    private var slashSuggestions: [SlashCommand] {
        guard inputText.hasPrefix("/") else { return [] }
        let word = String(inputText.dropFirst())
        guard !word.contains(" "), !word.contains("\n") else { return [] }
        let q = word.lowercased()
        if q.isEmpty { return commands }
        return commands.filter { $0.id.lowercased().hasPrefix(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if wsState == .connecting {
                HStack {
                    ProgressView().frame(width: 16, height: 16)
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
                        if hasMoreOlder {
                            Button {
                                Task { await loadOlder(proxy) }
                            } label: {
                                if loadingOlder {
                                    ProgressView().frame(width: 16, height: 16)
                                } else {
                                    Text("Load older messages")
                                }
                            }
                            .font(.caption)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                            .disabled(loadingOlder)
                        }
                        ForEach(visibleEvents) { event in
                            EventBubble(event: event)
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding()
                }
                .scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(TapGesture().onEnded { inputFocused = false })
                .onChange(of: visibleEvents.count) { _, _ in
                    // A prepended older page also changes this count; suppressBottomScroll
                    // tells us to keep position there instead of yanking to the bottom.
                    if suppressBottomScroll { return }
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

            if !slashSuggestions.isEmpty {
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(slashSuggestions) { cmd in
                            Button {
                                inputText = "/\(cmd.id) "
                                inputFocused = true
                            } label: {
                                HStack {
                                    Text("/\(cmd.id)").font(.body.monospaced())
                                    Spacer()
                                    Text(cmd.pluginName ?? cmd.scope)
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 180)
                .background(Color(.secondarySystemBackground))
            }

            Divider()

            HStack(spacing: 8) {
                Button(action: { showCommands = true; Task { await reloadCommands() } }) {
                    Image(systemName: "slash.circle")
                        .font(.title2)
                }
                TextField("Message…", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .focused($inputFocused)
                    .onSubmit { sendInput() }
                    .onChange(of: inputText) { old, new in
                        // First keystroke that starts a slash command refreshes the
                        // list so newly-added host commands show without reopening.
                        if !old.hasPrefix("/") && new.hasPrefix("/") {
                            Task { await reloadCommands() }
                        }
                    }
                if isRunning {
                    Button(action: { Task { try? await client.interrupt(sessionId: session.localId) } }) {
                        Image(systemName: "stop.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.red)
                    }
                } else {
                    Button(action: sendInput) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(12)
        }
        .navigationTitle(session.title ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showCommands) {
            CommandPicker(commands: commands) { cmd in
                inputText = "/\(cmd.id) "
                showCommands = false
                inputFocused = true
            }
        }
        .task {
            await loadDetail()
            await startWebSocket()
        }
    }

    private func loadDetail() async {
        do {
            detail = try await client.getSession(id: session.localId)
            isRunning = (detail?.session.status ?? session.status) == "running"
        } catch {
            self.error = error.localizedDescription
        }
        if let history = try? await client.getEvents(id: session.localId, limit: Self.pageSize) {
            events = history
            // A full page back implies there may be more older history to pull.
            hasMoreOlder = history.count >= Self.pageSize
        }
        await reloadCommands()
    }

    private func reloadCommands() async {
        do {
            commands = try await client.listCommands(sessionId: session.localId)
            print("[Companion] loaded \(commands.count) commands for session \(session.localId)")
        } catch {
            print("[Companion] listCommands failed: \(error)")
        }
    }

    private func loadOlder(_ proxy: ScrollViewProxy) async {
        guard !loadingOlder, hasMoreOlder else { return }
        // Oldest held event's uuid is the cursor; live (WS) events have no uuid but
        // only ever append at the bottom, so the head is always REST-sourced.
        guard let cursor = events.first?.uuid else { hasMoreOlder = false; return }
        loadingOlder = true
        defer { loadingOlder = false }
        // The event currently at the top stays put after we splice rows in above it.
        let anchorId = visibleEvents.first?.id
        guard let older = try? await client.getEvents(id: session.localId, limit: Self.pageSize, before: cursor) else {
            return
        }
        if older.count < Self.pageSize { hasMoreOlder = false }
        guard !older.isEmpty else { return }
        suppressBottomScroll = true
        events.insert(contentsOf: older, at: 0)
        Task { @MainActor in
            if let anchorId { proxy.scrollTo(anchorId, anchor: .top) }
            // Hold the suppression until after onChange has had a chance to fire on
            // the count bump, then re-arm bottom-follow for future live appends.
            try? await Task.sleep(nanoseconds: 150_000_000)
            suppressBottomScroll = false
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
            // Turn lifecycle drives the send/stop toggle. `result` ends a turn; an
            // assistant/user turn (re)starts one. Checked before the empty-text filter
            // because `result` events carry no prose and would otherwise be dropped.
            switch event.message?.type {
            case "result": isRunning = false
            case "assistant", "user": isRunning = true
            default: break
            }
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
        isRunning = true
        Task {
            try? await client.sendInput(sessionId: session.localId, text: text)
        }
    }
}

private struct CommandPicker: View {
    let commands: [SlashCommand]
    let onSelect: (SlashCommand) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [SlashCommand] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return commands }
        return commands.filter { $0.id.lowercased().contains(q) || $0.name.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { cmd in
                Button {
                    onSelect(cmd)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("/\(cmd.id)").font(.body.monospaced())
                            Spacer()
                            Text(cmd.pluginName ?? cmd.scope)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if cmd.name != cmd.id {
                            Text(cmd.name).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .searchable(text: $query, prompt: "Filter commands")
            .navigationTitle("Commands")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
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
