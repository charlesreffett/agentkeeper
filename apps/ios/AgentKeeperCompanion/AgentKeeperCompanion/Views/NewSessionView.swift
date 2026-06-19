import SwiftUI

struct NewSessionView: View {
    @ObservedObject var config: AppConfig
    var onCreated: (String) -> Void
    var onDismiss: () -> Void

    @State private var options: NewSessionOptions? = nil
    @State private var isLoading = false
    @State private var isCreating = false
    @State private var error: String? = nil

    @State private var projectPath = ""
    @State private var prompt = ""
    @State private var model = ""
    @State private var roleId = ""
    @State private var agencyKey = ""
    @State private var effort = ""
    @State private var permissionMode = "bypassPermissions"
    @State private var useWorktree = false
    @State private var branch = ""

    private var client: APIClient { APIClient(config: config) }

    private var canCreate: Bool {
        !projectPath.isEmpty && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isCreating
    }

    var body: some View {
        NavigationStack {
            Form {
                if let options {
                    formContent(options)
                } else if isLoading {
                    Section { ProgressView() }
                } else if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("New Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { Task { await create() } }
                        .disabled(!canCreate)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                }
            }
            .task { await loadOptions(projectPath: nil) }
        }
    }

    @ViewBuilder
    private func formContent(_ options: NewSessionOptions) -> some View {
        Section("Project") {
            Picker("Project", selection: $projectPath) {
                ForEach(options.projects) { project in
                    Text(project.name).tag(project.path)
                }
            }
            .onChange(of: projectPath) { _, newValue in
                Task { await loadProjectOptions(newValue) }
            }
        }

        Section("Prompt") {
            TextField("What should the agent do?", text: $prompt, axis: .vertical)
                .lineLimit(3...8)
        }

        Section("Agency") {
            Picker("Agency", selection: $agencyKey) {
                Text("None").tag("")
                ForEach(options.agencies ?? []) { agency in
                    Text(agency.name).tag(agency.key)
                }
            }
        }

        if agencyKey.isEmpty {
            Section("Role") {
                Picker("Role", selection: $roleId) {
                    Text("Freeform").tag("")
                    ForEach(options.roles ?? []) { role in
                        Text(role.name).tag(role.id)
                    }
                }
            }
        }

        Section("Model") {
            Picker("Model", selection: $model) {
                ForEach(options.models) { m in
                    Text(m.label).tag(m.value)
                }
            }
        }

        if agencyKey.isEmpty {
            Section("Options") {
                Picker("Effort", selection: $effort) {
                    ForEach(options.efforts, id: \.self) { e in
                        Text(e.capitalized).tag(e)
                    }
                }
                Picker("Permission Mode", selection: $permissionMode) {
                    ForEach(options.permissionModes, id: \.self) { p in
                        Text(p).tag(p)
                    }
                }
            }
        }

        Section("Worktree") {
            Toggle("Run in a worktree", isOn: $useWorktree)
            if useWorktree {
                TextField("Branch name", text: $branch)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
        }

        if let error {
            Section { Text(error).foregroundStyle(.red).font(.footnote) }
        }
    }

    @MainActor
    private func loadOptions(projectPath requested: String?) async {
        isLoading = true
        error = nil
        do {
            let opts = try await client.newSessionOptions(projectPath: requested)
            options = opts
            if projectPath.isEmpty {
                let initial = opts.focusedProjectPath ?? opts.projects.first?.path ?? ""
                projectPath = initial
                model = opts.defaultModel
                effort = opts.defaultEffort
                useWorktree = opts.defaultUseWorktree
                if !initial.isEmpty { await loadProjectOptions(initial) }
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func loadProjectOptions(_ path: String) async {
        guard !path.isEmpty else { return }
        do {
            let opts = try await client.newSessionOptions(projectPath: path)
            options = opts
            // Reset selections that may not exist in the newly loaded project.
            if !(opts.roles ?? []).contains(where: { $0.id == roleId }) { roleId = "" }
            if !(opts.agencies ?? []).contains(where: { $0.key == agencyKey }) { agencyKey = "" }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func create() async {
        isCreating = true
        error = nil
        var body: [String: Any] = [
            "projectPath": projectPath,
            "prompt": prompt.trimmingCharacters(in: .whitespacesAndNewlines),
            "useWorktree": useWorktree,
        ]
        if !model.isEmpty { body["model"] = model }
        if useWorktree && !branch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["branch"] = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if agencyKey.isEmpty {
            if !roleId.isEmpty { body["roleId"] = roleId }
            if !effort.isEmpty { body["effort"] = effort }
            if !permissionMode.isEmpty { body["permissionMode"] = permissionMode }
        } else {
            body["agencyKey"] = agencyKey
        }
        do {
            let sessionId = try await client.createSession(body)
            onCreated(sessionId)
        } catch {
            self.error = error.localizedDescription
        }
        isCreating = false
    }
}
