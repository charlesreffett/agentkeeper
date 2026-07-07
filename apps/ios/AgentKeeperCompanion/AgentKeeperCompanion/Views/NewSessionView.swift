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
    @State private var activePanel: ComposerPanel? = nil
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
            // Simultaneous so the tap still reaches the editor / scroll view;
            // any tap outside the composer bar collapses the open panel.
            .simultaneousGesture(TapGesture().onEnded { closePanel() })
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
        .simultaneousGesture(TapGesture().onEnded { closePanel() })
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

    // In-app drawer instead of UIKit Menu: menus presented from this bar hide
    // their label during presentation and flicker on dismissal. The drawer is
    // plain SwiftUI layout inside the safe-area inset, so it expands upward
    // above the keyboard and the icons never leave the hierarchy.
    private var composerToolbar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 22) {
                PhotosPicker(selection: $photoItems, maxSelectionCount: 5, matching: .images) {
                    Image(systemName: "photo")
                }

                panelButton(
                    .commands,
                    systemImage: "slash.circle",
                    highlighted: trimmedPrompt.hasPrefix("/")
                )
                panelButton(
                    .team,
                    systemImage: "person.2",
                    highlighted: !(agencyKey.isEmpty && roleId.isEmpty)
                )
                panelButton(.model, systemImage: "cpu", highlighted: false)
                if agencyKey.isEmpty {
                    panelButton(.tuning, systemImage: "slider.horizontal.3", highlighted: false)
                }
                panelButton(
                    .worktree,
                    systemImage: "arrow.triangle.branch",
                    highlighted: useWorktree
                )
                panelButton(.more, systemImage: "ellipsis.circle", highlighted: false)

                if isSyncing {
                    ProgressView().frame(width: 16, height: 16)
                }
            }
            .font(.title3)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let activePanel {
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        panelContent(activePanel)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 260)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(.bar)
        // Without this the icon row's children animate their positions
        // individually, so the tapped icon visibly lags behind the bar as
        // the drawer expands/collapses.
        .geometryGroup()
    }

    private func closePanel() {
        guard activePanel != nil else { return }
        withAnimation(.snappy(duration: 0.2)) { activePanel = nil }
    }

    private func panelButton(_ panel: ComposerPanel, systemImage: String, highlighted: Bool) -> some View {
        ComposerIconButton(systemImage: systemImage, active: activePanel == panel || highlighted) {
            withAnimation(.snappy(duration: 0.2)) {
                activePanel = activePanel == panel ? nil : panel
            }
        }
    }

    @ViewBuilder
    private func panelContent(_ panel: ComposerPanel) -> some View {
        switch panel {
        case .commands:
            panelHeader("Commands")
            if (options?.commands ?? []).isEmpty {
                Text("No commands in this project")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 4)
            }
            ForEach(options?.commands ?? []) { cmd in
                optionRow("/\(cmd.id)", selected: false) {
                    // A slash command must lead the prompt to expand on the host.
                    if trimmedPrompt.isEmpty {
                        prompt = "/\(cmd.id) "
                    } else if !trimmedPrompt.hasPrefix("/") {
                        prompt = "/\(cmd.id) " + prompt
                    } else {
                        prompt = "/\(cmd.id) "
                    }
                    promptFocused = true
                    closePanel()
                }
            }

        case .team:
            panelHeader("Agency")
            optionRow("None", selected: agencyKey.isEmpty) { agencyKey = "" }
            ForEach(options?.agencies ?? []) { agency in
                optionRow(agency.name, selected: agencyKey == agency.key) { agencyKey = agency.key }
            }
            if agencyKey.isEmpty {
                panelHeader("Role")
                optionRow("Freeform", selected: roleId.isEmpty) { roleId = "" }
                ForEach(options?.roles ?? []) { role in
                    optionRow(role.name, selected: roleId == role.id) { roleId = role.id }
                }
            }

        case .model:
            panelHeader("Model")
            ForEach(options?.models ?? []) { m in
                optionRow(m.label, selected: model == m.value) { model = m.value }
            }

        case .tuning:
            panelHeader("Effort")
            ForEach(options?.efforts ?? [], id: \.self) { e in
                optionRow(e.capitalized, selected: effort == e) { effort = e }
            }
            panelHeader("Permission Mode")
            ForEach(options?.permissionModes ?? [], id: \.self) { p in
                optionRow(p, selected: permissionMode == p) { permissionMode = p }
            }

        case .worktree:
            Toggle("Run in a worktree", isOn: $useWorktree)
                .font(.subheadline)
                .padding(.vertical, 8)
                .padding(.horizontal, 4)
            if useWorktree {
                Button {
                    showBranchAlert = true
                } label: {
                    HStack {
                        Label(branch.isEmpty ? "Branch: auto" : "Branch: \(branch)", systemImage: "arrow.triangle.branch")
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .font(.subheadline)
                .padding(.vertical, 8)
                .padding(.horizontal, 4)
            }

        case .more:
            Button {
                saveDraft()
            } label: {
                Label("Save Draft", systemImage: "doc.text")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(trimmedPrompt.isEmpty)
            .font(.subheadline)
            .padding(.vertical, 8)
            .padding(.horizontal, 4)

            Button {
                Task { await resync() }
            } label: {
                Label("Re-sync with host", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isSyncing)
            .font(.subheadline)
            .padding(.vertical, 8)
            .padding(.horizontal, 4)

            if let lastSyncedAt = optionsStore.lastSyncedAt {
                Text("Synced \(lastSyncedAt.formatted(.relative(presentation: .named)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func panelHeader(_ text: String) -> some View {
        ComposerPanelHeader(text: text)
    }

    private func optionRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        ComposerOptionRow(title: title, selected: selected, action: action)
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
        // Entries cached before commands were added to the payload have nil
        // commands — treat those as stale so the field backfills on next open.
        guard optionsStore.isStale(projectPath: path) || options?.commands == nil else { return }
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

enum ComposerPanel {
    case commands, team, model, tuning, worktree, more
}

// MARK: - Shared composer chrome (used by NewSessionView and SessionDetailView
// so both composers look and behave identically)

struct ComposerIconButton: View {
    let systemImage: String
    var active: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .foregroundStyle(active ? Color.accentColor : Color.secondary)
        }
    }
}

struct ComposerPanelHeader: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 8)
            .padding(.horizontal, 4)
    }
}

struct ComposerOptionRow: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .font(.subheadline)
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
    }
}

struct AttachmentThumbnail: View {
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

extension UIImage {
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
