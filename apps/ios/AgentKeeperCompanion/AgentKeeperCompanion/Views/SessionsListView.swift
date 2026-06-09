import SwiftUI

struct SessionsListView: View {
    @ObservedObject var config: AppConfig
    @State private var sessions: [SessionSummary] = []
    @State private var isLoading = false
    @State private var error: String? = nil
    @State private var showingSetup = false

    private var client: APIClient { APIClient(config: config) }

    var body: some View {
        List(sessions) { session in
            NavigationLink(destination: SessionDetailView(session: session, config: config)) {
                SessionRowView(session: session)
            }
        }
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Settings") { showingSetup = true }
            }
        }
        .refreshable { await loadSessions() }
        .task { await loadSessions() }
        .overlay {
            if isLoading && sessions.isEmpty {
                ProgressView()
            } else if let error, sessions.isEmpty {
                ContentUnavailableView("Error", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if sessions.isEmpty {
                ContentUnavailableView("No Sessions", systemImage: "terminal", description: Text("Start a session in the desktop app."))
            }
        }
        .sheet(isPresented: $showingSetup) {
            SetupView(config: config, onDismiss: { showingSetup = false })
        }
    }

    private func loadSessions() async {
        isLoading = true
        error = nil
        do {
            sessions = try await client.listSessions()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
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
                    Text(Date(timeIntervalSince1970: (session.lastActivityAt ?? session.startedAt) / 1000), style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
