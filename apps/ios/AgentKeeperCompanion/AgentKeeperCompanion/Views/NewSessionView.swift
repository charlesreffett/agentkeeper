import SwiftUI
import PhotosUI
import UIKit

// Reddit-style composer: nav bar carries cancel / project chip / Start, the
// prompt is a full-screen editor with attached images above it, and all the
// session knobs live in a toolbar pinned above the keyboard.
struct NewSessionView: View {
    @ObservedObject var config: AppConfig
    var onCreated: (String) -> Void
    var onDismiss: () -> Void

    @ObservedObject private var optionsStore = OptionsStore.shared
    @ObservedObject private var draftStore = DraftStore.shared

    private let existingDraft: SessionDraft?

    @State private var options: NewSessionOptions? = nil
    @State private var isLoading = false
    @State private var isSyncing = false
    @State private var isCreating = false
    @State private var isOffline = false
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
    @State private var attachments: [AttachmentPayload] = []

    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showBranchAlert = false
    @State private var showSaveDraftAlert = false
    @FocusState private var promptFocused: Bool

    init(
        config: AppConfig,
        draft: SessionDraft? = nil,
        onCreated: @escaping (String) -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.config = config
        self.existingDraft = draft
        self.onCreated = onCreated
        self.onDismiss = onDismiss
        if let draft {
            _projectPath = State(initialValue: draft.projectPath)
            _prompt = State(initialValue: draft.prompt)
            _model = State(initialValue: draft.model)
            _roleId = State(initialValue: draft.roleId)
            _agencyKey = State(initialValue: draft.agencyKey)
            _effort = State(initialValue: draft.effort)
            _permissionMode = State(initialValue: draft.permissionMode)
            _useWorktree = State(initialValue: draft.useWorktree)
            _branch = State(initialValue: draft.branch)
            _attachments = State(initialValue: draft.attachments ?? [])
        }
    }

    private var client: APIClient { APIClient(config: config) }

    private var trimmedPrompt: String {
        prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canCreate: Bool {
        !projectPath.isEmpty && !trimmedPrompt.isEmpty && !isCreating
    }

    private var currentProjectName: String {
        options?.projects.first(where: { $0.path == projectPath })?.name
            ?? (projectPath.isEmpty ? "Select project" : URL(fileURLWithPath: projectPath).lastPathComponent)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if isOffline {
                        Label("Offline — using data from the last sync. Save a draft and start it once connected.", systemImage: "wifi.slash")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.secondary.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.red.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    if isLoading && options == nil {
                        HStack {
                            ProgressView().frame(width: 16, height: 16)
                            Text("Loading options…").font(.caption).foregroundStyle(.secondary)
                        }
                    }

                    if !attachments.isEmpty {
                        attachmentsRow
                    }

                    promptEditor
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) { composerToolbar }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { onDismiss() } label: {
                        Image(systemName: "xmark")
                    }
                }
                ToolbarItem(placement: .principal) {
                    projectChip
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Start").fontWeight(.semibold)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .disabled(!canCreate)
                }
            }
            .alert("Worktree branch", isPresented: $showBranchAlert) {
                TextField("Branch name (optional)", text: $branch)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Button("Done") {}
            } message: {
                Text("Leave empty to auto-generate a branch name.")
            }
            .alert("Can't Reach Desktop", isPresented: $showSaveDraftAlert) {
                Button("Save as Draft") { saveDraft() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The session couldn't be started because the desktop app is unreachable. Save it as a draft and start it once you're connected?")
            }
            .task {
                await loadOptions()
                // A draft pre-fills projectPath, so the picker's onChange never
                // fires; load project-scoped options explicitly.
                if existingDraft != nil { await loadProjectOptions(projectPath) }
                promptFocused = true
            }
            .onChange(of: projectPath) { _, newValue in
                Task { await loadProjectOptions(newValue) }
            }
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await appendPhotos(items) }
            }
        }
    }

    // MARK: - Composer pieces

    private var projectChip: some View {
        Menu {
            ForEach(options?.projects ?? []) { project in
                Button {
                    projectPath = project.path
                } label: {
                    if project.path == projectPath {
                        Label(project.name, systemImage: "checkmark")
                    } else {
                        Text(project.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(currentProjectName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.15))
            .clipShape(Capsule())
        }
        .foregroundStyle(.primary)
    }

    private var attachmentsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(attachments) { attachment in
                    AttachmentThumbnail(attachment: attachment) {
                        attachments.removeAll { $0.id == attachment.id }
                    }
                }
            }
        }
    }

    private var promptEditor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $prompt)
                .focused($promptFocused)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 200)
            if prompt.isEmpty {
                Text("What should the agent do?")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                    .padding(.leading, 5)
                    .allowsHitTesting(false)
            }
        }
    }

    private var composerToolbar: some View {
        VStack(spacing: 0) {
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 5, matching: .images) {
                        Image(systemName: "photo")
                    }

                    Menu {
                        Picker("Agency", selection: $agencyKey) {
                            Text("None").tag("")
                            ForEach(options?.agencies ?? []) { agency in
                                Text(agency.name).tag(agency.key)
                            }
                        }
                        if agencyKey.isEmpty {
                            Picker("Role", selection: $roleId) {
                                Text("Freeform").tag("")
                                ForEach(options?.roles ?? []) { role in
                                    Text(role.name).tag(role.id)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "person.2")
                            .foregroundStyle(agencyKey.isEmpty && roleId.isEmpty ? Color.secondary : Color.accentColor)
                    }

                    Menu {
                        Picker("Model", selection: $model) {
                            ForEach(options?.models ?? []) { m in
                                Text(m.label).tag(m.value)
                            }
                        }
                    } label: {
                        Image(systemName: "cpu")
                    }

                    if agencyKey.isEmpty {
                        Menu {
                            Picker("Effort", selection: $effort) {
                                ForEach(options?.efforts ?? [], id: \.self) { e in
                                    Text(e.capitalized).tag(e)
                                }
                            }
                            Picker("Permission Mode", selection: $permissionMode) {
                                ForEach(options?.permissionModes ?? [], id: \.self) { p in
                                    Text(p).tag(p)
                                }
                            }
                        } label: {
                            Image(systemName: "slider.horizontal.3")
                        }
                    }

                    Menu {
                        Toggle("Run in a worktree", isOn: $useWorktree)
                        if useWorktree {
                            Button {
                                showBranchAlert = true
                            } label: {
                                Label(branch.isEmpty ? "Branch: auto" : "Branch: \(branch)", systemImage: "arrow.triangle.branch")
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.triangle.branch")
                            .foregroundStyle(useWorktree ? Color.accentColor : Color.secondary)
                    }

                    Menu {
                        Button {
                            saveDraft()
                        } label: {
                            Label("Save Draft", systemImage: "doc.text")
                        }
                        .disabled(trimmedPrompt.isEmpty)

                        Button {
                            Task { await resync() }
                        } label: {
                            Label("Re-sync with host", systemImage: "arrow.clockwise")
                        }
                        .disabled(isSyncing)

                        if let lastSyncedAt = optionsStore.lastSyncedAt {
                            Text("Synced \(lastSyncedAt.formatted(.relative(presentation: .named)))")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }

                    if isSyncing {
                        ProgressView().frame(width: 16, height: 16)
                    }
                }
                .font(.title3)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(.bar)
        }
    }

    // MARK: - Photos

    private func appendPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data) else { continue }
            let resized = image.resizedIfNeeded(maxDimension: 1568)
            guard let jpeg = resized.jpegData(compressionQuality: 0.7) else { continue }
            attachments.append(AttachmentPayload(
                name: "photo-\(Int(Date().timeIntervalSince1970))-\(attachments.count + 1).jpg",
                mimeType: "image/jpeg",
                content: jpeg.base64EncodedString()
            ))
        }
        photoItems = []
    }

    // MARK: - Options loading (cache-first, TTL refresh)

    @MainActor
    private func loadOptions(force: Bool = false) async {
        error = nil
        if options == nil, let cached = optionsStore.cached(projectPath: nil) {
            applyOptions(cached)
        }
        guard force || options == nil || optionsStore.isStale(projectPath: nil) else { return }
        isLoading = options == nil
        do {
            let opts = try await optionsStore.sync(client: client)
            applyOptions(opts)
            isOffline = false
        } catch let e as APIError where e.isConnectionFailure {
            if options != nil {
                isOffline = true
            } else {
                self.error = e.errorDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func applyOptions(_ opts: NewSessionOptions) {
        let isFirstLoad = options == nil
        options = opts
        if projectPath.isEmpty {
            // Setting projectPath triggers onChange, which loads project-scoped options.
            projectPath = opts.focusedProjectPath ?? opts.projects.first?.path ?? ""
        }
        if model.isEmpty { model = opts.defaultModel }
        if effort.isEmpty { effort = opts.defaultEffort }
        if isFirstLoad && existingDraft == nil { useWorktree = opts.defaultUseWorktree }
    }

    @MainActor
    private func loadProjectOptions(_ path: String) async {
        guard !path.isEmpty else { return }
        if let cached = optionsStore.cached(projectPath: path) {
            options = cached
            reconcileSelections(cached)
        }
        guard optionsStore.isStale(projectPath: path) else { return }
        do {
            let opts = try await optionsStore.sync(client: client, projectPath: path)
            options = opts
            reconcileSelections(opts)
            isOffline = false
        } catch let e as APIError where e.isConnectionFailure {
            isOffline = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    // Reset selections that may not exist in the newly loaded project.
    private func reconcileSelections(_ opts: NewSessionOptions) {
        if !(opts.roles ?? []).contains(where: { $0.id == roleId }) { roleId = "" }
        if !(opts.agencies ?? []).contains(where: { $0.key == agencyKey }) { agencyKey = "" }
    }

    @MainActor
    private func resync() async {
        isSyncing = true
        error = nil
        do {
            let opts = try await optionsStore.sync(client: client)
            applyOptions(opts)
            if !projectPath.isEmpty {
                let projectOpts = try await optionsStore.sync(client: client, projectPath: projectPath)
                options = projectOpts
                reconcileSelections(projectOpts)
            }
            isOffline = false
        } catch let e as APIError where e.isConnectionFailure {
            isOffline = true
        } catch {
            self.error = error.localizedDescription
        }
        isSyncing = false
    }

    // MARK: - Draft + create

    private func saveDraft() {
        let draft = SessionDraft(
            id: existingDraft?.id ?? UUID(),
            createdAt: existingDraft?.createdAt ?? Date(),
            projectPath: projectPath,
            prompt: prompt,
            model: model,
            roleId: roleId,
            agencyKey: agencyKey,
            effort: effort,
            permissionMode: permissionMode,
            useWorktree: useWorktree,
            branch: branch,
            attachments: attachments.isEmpty ? nil : attachments
        )
        draftStore.save(draft)
        onDismiss()
    }

    @MainActor
    private func create() async {
        isCreating = true
        error = nil
        var body: [String: Any] = [
            "projectPath": projectPath,
            "prompt": trimmedPrompt,
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
        if !attachments.isEmpty {
            body["attachments"] = attachments.map { $0.asJSON }
        }
        do {
            let sessionId = try await client.createSession(body)
            if let existingDraft { draftStore.delete(existingDraft.id) }
            onCreated(sessionId)
        } catch let e as APIError where e.isConnectionFailure {
            isOffline = true
            showSaveDraftAlert = true
        } catch {
            self.error = error.localizedDescription
        }
        isCreating = false
    }
}

private struct AttachmentThumbnail: View {
    let attachment: AttachmentPayload
    let onRemove: () -> Void

    private var image: UIImage? {
        guard let data = Data(base64Encoded: attachment.content) else { return nil }
        return UIImage(data: data)
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 110, height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.secondary.opacity(0.15))
                    .frame(width: 110, height: 110)
                    .overlay { Image(systemName: "photo").foregroundStyle(.secondary) }
            }
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(6)
                    .background(.black.opacity(0.6))
                    .clipShape(Circle())
            }
            .padding(6)
        }
    }
}

private extension UIImage {
    func resizedIfNeeded(maxDimension: CGFloat) -> UIImage {
        let largest = max(size.width, size.height)
        guard largest > maxDimension else { return self }
        let scaleFactor = maxDimension / largest
        let newSize = CGSize(width: size.width * scaleFactor, height: size.height * scaleFactor)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
