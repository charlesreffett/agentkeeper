import SwiftUI

struct SessionsListView: View {
    @ObservedObject var config: AppConfig
    @ObservedObject private var draftStore = DraftStore.shared
    @State private var sessions: [SessionSummary] = []
    @State private var isLoading = false
    @State private var error: String? = nil
    @State private var connectionFailed = false
    @State private var showingSetup = false
    @State private var showingNewSession = false
    @State private var editingDraft: SessionDraft? = nil
    @State private var deleteError: String? = nil
    @State private var wsClient = WebSocketClient()

    private var client: APIClient { APIClient(config: config) }

    private var isEmpty: Bool { sessions.isEmpty && draftStore.drafts.isEmpty }

    var body: some View {
        List {
            if connectionFailed && !isEmpty {
                Section {
                    Label("Can't reach the desktop app", systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if !draftStore.drafts.isEmpty {
                Section("Drafts") {
                    ForEach(draftStore.drafts) { draft in
                        Button { editingDraft = draft } label: {
                            DraftRowView(draft: draft)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                draftStore.delete(draft.id)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .accessibilityLabel("Delete")
                        }
                    }
                }
            }
            Section(draftStore.drafts.isEmpty ? "" : "Sessions") {
                ForEach(sessions) { session in
                    NavigationLink(destination: SessionDetailView(session: session, config: config)) {
                        SessionRowView(session: session)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            Task { await deleteSession(session) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("Delete")
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showingNewSession = true } label: {
                    Image(systemName: "plus")
                }
            }
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Settings") { showingSetup = true }
            }
        }
        .refreshable { await loadSessions() }
        .task { await loadSessions() }
        .task { await watchSessions() }
        .task { await OptionsStore.shared.syncIfStale(client: client) }
        .overlay {
            if isLoading && isEmpty {
                ProgressView()
            } else if connectionFailed, isEmpty {
                ContentUnavailableView {
                    Label("Can't Reach Host", systemImage: "wifi.slash")
                } description: {
                    Text("Make sure AgentKeeper is running on your desktop and this device is on the same network.")
                } actions: {
                    Button("Retry") { Task { await loadSessions() } }
                }
            } else if let error, isEmpty {
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await loadSessions() } }
                }
            } else if isEmpty {
                ContentUnavailableView("No Sessions", systemImage: "terminal", description: Text("Start a session in the desktop app."))
            }
        }
        .alert("Couldn't Delete Session", isPresented: Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
        .sheet(isPresented: $showingSetup) {
            SetupView(config: config, onDismiss: { showingSetup = false })
        }
        .sheet(isPresented: $showingNewSession) {
            NewSessionView(
                config: config,
                onCreated: { _ in
                    showingNewSession = false
                    Task { await loadSessions() }
                },
                onDismiss: { showingNewSession = false }
            )
        }
        .sheet(item: $editingDraft) { draft in
            NewSessionView(
                config: config,
                draft: draft,
                onCreated: { _ in
                    editingDraft = nil
                    Task { await loadSessions() }
                },
                onDismiss: { editingDraft = nil }
            )
        }
    }

    private func deleteSession(_ session: SessionSummary) async {
        // Optimistic removal so the row animates out with the swipe; restore on failure.
        let removed = sessions
        withAnimation(.easeOut(duration: 0.2)) {
            sessions.removeAll { $0.localId == session.localId }
        }
        do {
            try await client.deleteSession(id: session.localId)
        } catch let e as APIError {
            sessions = removed
            if case .serverError(409) = e {
                deleteError = "Session is running — stop it before deleting."
            } else {
                deleteError = e.errorDescription
            }
        } catch {
            sessions = removed
            deleteError = error.localizedDescription
        }
    }

    private func loadSessions() async {
        isLoading = true
        error = nil
        do {
            sessions = try await client.listSessions()
            connectionFailed = false
        } catch let e as APIError {
            connectionFailed = e.isConnectionFailure
            self.error = e.errorDescription
        } catch {
            connectionFailed = false
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    // Live list updates: the desktop pings this topic whenever any session's
    // status changes (created, started, completed). Reload on each ping.
    private func watchSessions() async {
        let stream = await wsClient.connectSignals(
            baseURL: config.baseURL,
            secretKey: config.secretKey,
            topic: sessionsListTopic
        )
        for await _ in stream {
            await loadSessions()
        }
    }
}

private struct DraftRowView: View {
    let draft: SessionDraft

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(draft.prompt.prefix(60))
                    .font(.body)
                    .lineLimit(1)
                Text(draft.projectName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct SessionRowView: View {
    let session: SessionSummary

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(session.status == "running" ? Color.green : Color.secondary)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title ?? session.initialPrompt?.prefix(60).description ?? session.localId)
                    .font(.body)
                    .lineLimit(1)
                HStack {
                    if let model = session.model {
                        Text(model).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(relativeTime(from: (session.lastActivityAt ?? session.startedAt) / 1000))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func relativeTime(from epochSeconds: Double, now: Date = Date()) -> String {
        let diff = now.timeIntervalSince1970 - epochSeconds
        let minute = 60.0
        let hour = 3600.0
        let day = 86400.0
        let week = 604800.0
        if diff < minute { return "just now" }
        if diff < hour { return "\(Int((diff / minute).rounded()))m ago" }
        if diff < day { return "\(Int((diff / hour).rounded()))h ago" }
        if diff < week { return "\(Int((diff / day).rounded()))d ago" }
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: Date(timeIntervalSince1970: epochSeconds))
    }
}
